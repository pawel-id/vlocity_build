const vlocity = require('../vlocity');
const utilityservice = require('../utilityservice');
const VlocityUILayout = require('./vlocityuilayout');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');

let VlocityCard = module.exports = function(vlocity) {
    this.vlocity = vlocity;
};

 
VlocityCard.prototype.flexCardDeployWithPuppeteer = async function(jobInfo, flexCardId, flexCardKey){

        let success = false;
        const page = await this.vlocity.utilityservice.getPuppeteerPage(jobInfo);

        try {
            let package = this.vlocity.namespacePrefix;
            let siteUrl = this.vlocity.jsForceConnection.instanceUrl;

            let flexCardCompilePage = siteUrl + '/apex/' + package + 'FlexCardCompilePage?id=' + flexCardId;

            VlocityUtils.report('Starting FlexCard LWC Activation', `${flexCardKey} (${flexCardId})`);
            VlocityUtils.verbose('LWC FlexCard Activation URL', flexCardCompilePage);

            let errorMessage;
            
            const timeout = jobInfo.loginTimeoutForLoginLWC;
            await Promise.all([ page.waitForNavigation(), page.goto(flexCardCompilePage, { timeout }) ]);
            await page.waitForTimeout(5000);
            
            let tries = 0;
            let jsonError;
            
            let maxNumOfTries = Math.ceil((60/jobInfo.defaultLWCPullTimeInSeconds)*jobInfo.defaultMinToWaitForLWCFlexCards);
            while (tries < maxNumOfTries && !jobInfo.ignoreLWCActivationCards) {
                try {
                    let message;
                    try {
                        message = await page.waitForSelector('#compileMessage-0');
                    } catch (messageTimeout) {
                        await this.vlocity.utilityservice.detectDeadBrowser(messageTimeout);
                        VlocityUtils.verbose('Error', messageTimeout);
                        VlocityUtils.log('FlexCard LWC Activation', 'Loading Page taking too long - Retrying - Tries: ' + tries + ' of ' + maxNumOfTries);
                    }
                    
                    if (message) { 
                        let currentStatus = await message.evaluate(node => node.innerText);
                        VlocityUtils.report('Activating LWC for FlexCard', `${flexCardKey} (${flexCardId})`, currentStatus);
                        jobInfo.elapsedTime = VlocityUtils.getTime();
                        VlocityUtils.report('Elapsed Time', jobInfo.elapsedTime);
                        if (currentStatus === 'DONE SUCCESSFULLY') {
                            success = true;

                            // not sure if this is proper way to set success
                            jobInfo.currentStatus[cardKey] = 'Success';
                            delete jobInfo.currentErrors[cardKey]

                            VlocityUtils.success('LWC FlexCard Activated', `${flexCardKey} (${flexCardId})`);
                            break;
                        } else if (currentStatus === 'DONE WITH ERRORS') {
                            let jsonResulNode  = await page.waitForSelector('#resultJSON-0');
                            jsonError = await jsonResulNode.evaluate(node => node.innerText);
                            VlocityUtils.verbose('LWC FlexCard Compilation Error Result', `${flexCardKey} (${flexCardId})`, jsonError);
                            break;
                        } 
                    }
                } catch (e) {
                    VlocityUtils.error('Error Activating LWC', e);
                }
                tries++;
                await page.waitForTimeout(jobInfo.defaultLWCPullTimeInSeconds*1000);
            }

            if (tries == maxNumOfTries) {
                errorMessage = 'Activation took longer than ' + jobInfo.defaultMinToWaitForLWCFlexCards + ' minutes - Aborted';
            }

            if (jsonError) {
                jobInfo.hasError = true;
                let failedCards = JSON.parse(jsonError).failedCards;
                let failedCardsIds = Object.keys(failedCards);
                for (let i = 0; i < failedCardsIds.length; i++) {
                    let failedCardsId = failedCardsIds[i];
                    let errorMessageCard = failedCards[failedCardsId];
                    let cardKey = jobInfo.flexCardsToCompile[failedCardsId];
                    jobInfo.currentStatus[cardKey] = 'Error';
                    jobInfo.currentErrors[cardKey] = 'LWC Activation Error >> ' + cardKey + ' - ' + errorMessageCard;
                    jobInfo.errors.push('LWC Activation Error >> ' + cardKey + ' - ' + errorMessageCard);
                    VlocityUtils.error('LWC Activation Error', cardKey + ' - ' +  errorMessageCard);
                }
            }
            
            if (errorMessage) {
                jobInfo.hasError = true;
                let failedCardsIds = Object.keys(jobInfo.flexCardsToCompile);
                for (let i = 0; i < failedCardsIds.length; i++) {
                    let failedCardsId = failedCardsIds[i];
                    let cardKey = jobInfo.flexCardsToCompile[failedCardsId];
                    jobInfo.currentStatus[cardKey] = 'Error';
                    jobInfo.errors.push('LWC Activation Error >> ' + cardKey + ' - ' + errorMessage);
                    VlocityUtils.error('LWC Activation Error', cardKey + ' - ' +  errorMessage);
                }
            }       
        } catch (e) {
            await this.vlocity.utilityservice.detectDeadBrowser(e);
            jobInfo.hasError = true;
            var failedCardsIds = Object.keys(jobInfo.flexCardsToCompile);
            for (let i = 0; i < failedCardsIds.length; i++) {
                var failedCardsId = failedCardsIds[i];
                var cardKey = jobInfo.flexCardsToCompile[failedCardsId];
                jobInfo.currentStatus[cardKey] = 'Error';
                jobInfo.errors.push('LWC Activation Error >> ' + cardKey + ' - ' + e);
                VlocityUtils.error('LWC Activation Error', cardKey + ' - ' +  e);
            }
        } finally {
            if (!success) await this.vlocity.utilityservice.savePuppeteerScreenLog(jobInfo, page, flexCardKey);
            try { await page.close(); } catch (e) {}
        }
    return success;
}

VlocityCard.prototype.onDeployFinish = async function(jobInfo) { 
    if (jobInfo.flexCardsToCompile) {
        let hasFlexCardCompiler = true;

        if (!jobInfo.ignoreLWCActivationCards && !jobInfo.checkLWCActivationCards) {
            let minVersions = yaml.safeLoad(fs.readFileSync(path.join(__dirname,'..', 'buildToolsMinVersionCards-LWC.yaml'), 'utf8'));
            let minVersion = minVersions[this.vlocity.namespace]
            let currentVersion = this.vlocity.PackageVersion;
            if (minVersion && currentVersion && !(currentVersion >= minVersion)) {
                jobInfo.ignoreLWCActivationCards = true;
                VlocityUtils.error('Cards LWC Activation', 'Unsupported Managed package Version, LWC Activation disabled');
            }
            jobInfo.checkLWCActivationCards = true;
        }

        if (jobInfo.ignoreLWCActivationCards) {
            return;
        }

        if(Object.keys(jobInfo.flexCardsToCompile).length === 0) {
            return;
        }

        try { 
            let idsArray = Object.keys(jobInfo.flexCardsToCompile);
            
            //--------Load Flexcard compiler-------
            // Make sure we load the package version
            await this.vlocity.utilityservice.getPackageVersion();

            const compilerName = 'flexcard-compiler';
            const namespace = this.vlocity.namespace;
            const packageVersion = this.vlocity.PackageVersion;   

            const flexCardsCompiler = await VlocityUtils.loadCompiler(compilerName,
                                            jobInfo, packageVersion, namespace);
            if(flexCardsCompiler){
                for (let i = 0; i < idsArray.length; i++) { 
                    let flexCardID = idsArray[i];
                    await this.compileFlexCardsLwc(flexCardID,jobInfo,flexCardsCompiler) ;
                } 
            } else{
                hasFlexCardCompiler= false;
            }

        } catch (e) {

            hasFlexCardCompiler= false;
            VlocityUtils.error('Error while loading Flexcard Compiler', e);
        }

         // If we were unable to load the compiler package, use the legacy method
        if(!hasFlexCardCompiler) {
            VlocityUtils.report("Legacy fall back flow for compiling Flexcards with Puppeteer ");
            let count = Object.keys(jobInfo.flexCardsToCompile).length
            let flexCardsToRetry = {};
            let retry = 0;

            while (count > 0 && retry < 5) {
                VlocityUtils.report("Flexcards to compile", count, "Retry", retry);
                let compiled = 0;

                // worker function to be called in parallel
                const worker = async (flexCardId) => {
                    const flexCardKey = jobInfo.flexCardsToCompile[flexCardId];
                    const success = await this.flexCardDeployWithPuppeteer(jobInfo, flexCardId, flexCardKey);
                    if (success) {
                        VlocityUtils.report("Compiled", ++compiled, 'of', count);
                    } else {
                        flexCardsToRetry[flexCardId] = flexCardKey;
                    }
                }

                const queue = require('fastq').promise(worker, 5)
                Object.keys(jobInfo.flexCardsToCompile).forEach(flexCardId => queue.push(flexCardId))
                await queue.drained();

                jobInfo.flexCardsToCompile = flexCardsToRetry;
                flexCardsToRetry = {};
                count = Object.keys(jobInfo.flexCardsToCompile).length;
                retry++;
            }
            VlocityUtils.report("Flexcards compiled");
            return;

        }
    }

    if(!jobInfo.haveCompiledUILayouts) {
        let layoutOb = new VlocityUILayout(this.vlocity);
        await layoutOb.onDeployFinish(jobInfo);
    }
} 
VlocityCard.prototype.compileFlexCardsLwc = async function (flexCardID,jobInfo,flexCardsCompiler) {
    VlocityUtils.report('Compiling Flexcard with  FlexCard ID: ',flexCardID); 
    try { 
        const isInsidePackage = !(this.vlocity.PackageVersion === 'DeveloperOrg');
        const tempSfdxFolder = path.join(jobInfo.tempFolder, 'tempDeployLWC', 'salesforce_sfdx/lwc');
          
        const fCCompiler = new flexCardsCompiler(this.vlocity.namespace, this.vlocity.jsForceConnection,
                                                 this.vlocity.jsForceConnection.instanceUrl, isInsidePackage);  
        await fCCompiler.compileMetadataWithId(flexCardID, tempSfdxFolder);
        jobInfo.deployGeneratedLwc = true; 
    }
    catch (e) {
        hasFlexCardCompiler= false;
        VlocityUtils.error(e);
    }
    
} 

VlocityCard.prototype.afterActivationSuccess = async function(inputMap) {
    var jobInfo = inputMap.jobInfo;   
    var dataPack = inputMap.dataPack;
    var data = dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityCard__c'] || dataPack.VlocityDataPackData['OmniUiCard'];
    var cardSourceKey = data[0].VlocityRecordSourceKey;
    var definition = data[0]['%vlocity_namespace%__Definition__c'] || data[0]['PropertySetConfig'];
    var isFlexCard = definition.includes('"isFlex":true,');
    var isLWC = definition.includes('"enableLwc":true,');
    if (isFlexCard) {
        if (!jobInfo.flexCardsToCompile) {
            jobInfo.flexCardsToCompile = {};
        }
        VlocityUtils.log('LWC for FlexCard will be compiled at the end', dataPack.VlocityDataPackKey);
        jobInfo.flexCardsToCompile[jobInfo.sourceKeyToRecordId[cardSourceKey]] = dataPack.VlocityDataPackKey;
    } else if (isLWC && jobInfo.lookForParentLayoutsForlWCCards) {
        var parentUILayouts = await this.addParentUILayoutForCard(jobInfo,dataPack.VlocityDataPackKey);
    }
}


VlocityCard.prototype.addParentUILayoutForCard = async function(jobInfo,carKey) {

    if (!jobInfo.UILayoutsToCompile) {
        jobInfo.UILayoutsToCompile =  {};
    }

    var cardsKeys = Object.keys(jobInfo.sourceKeyToMatchingKeysData);
    for (let i = 0; i < cardsKeys.length; i++) {
        var key = cardsKeys[i];
        var LayoutsToLookFor = [];
        if (key.includes('VlocityUILayout')) {
            var object = jobInfo.sourceKeyToMatchingKeysData[key];
            var definition = object['%vlocity_namespace%__Definition__c'] || object['PropertySetConfig'];
            var definitionFile = path.join(jobInfo.projectPath, jobInfo.expansionPath, 'VlocityUILayout', object.Name, definition);
            var UILayoutName = object.Name;
            let rawdata = fs.readFileSync(definitionFile);
            if (rawdata) {
                let definitionContent = JSON.parse(rawdata);
                var UILayoutcards = definitionContent.Cards;
                if (UILayoutcards) {
                    for (let i = 0; i < UILayoutcards.length; i++) {
                        var cardName = UILayoutcards[i];
                        if(carKey.split('/')[1] == cardName){
                            LayoutsToLookFor.push(UILayoutName)
                        }      
                    }
                }
            }
        }  
        if (LayoutsToLookFor.length > 0) {      
            var query = `SELECT ID, Name FROM ${this.vlocity.namespacePrefix}VlocityUILayout__c WHERE ${this.vlocity.namespacePrefix}Active__c = true AND Name IN (`
            for (let i = 0; i < LayoutsToLookFor.length; i++) {
                var UILayoutName = LayoutsToLookFor[i];
                query += "'" + UILayoutName + "',"; 
            }
            query = query.substring(0, query.length - 1) + ')';
            try {
                var result = await this.vlocity.jsForceConnection.query(query);
                var records = await result.records;
                for (let i = 0; i < records.length; i++) {
                    const element = records[i];
                    //console.log(element);
                    jobInfo.UILayoutsToCompile[element.Id] = 'VlocityUILayout/' + element.Name;
                    VlocityUtils.log('LWC for VlocityUILayout will be compiled at the end for chield Card', carKey);
                }
            } catch (error) {
                VlocityUtils.error('Could not get Parent VlocityUILayout for Card ', carKey + ' - ' +  error);
            }
        }
    }
}
