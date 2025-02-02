var vlocity = require('../vlocity');
var utilityservice = require('../utilityservice');
var fs = require('fs-extra');
var path = require('path');
var yaml = require('js-yaml');

var VlocityUILayout = module.exports = function(vlocity) {
	this.vlocity = vlocity;
};

VlocityUILayout.prototype.onDeployFinish = async function(jobInfo) {

    jobInfo.haveCompiledUILayouts = true;

    if (jobInfo.UILayoutsToCompile) {
        if (!jobInfo.ignoreLWCActivationCards && !jobInfo.checkLWCActivationCards) {
            var minVersions = yaml.safeLoad(fs.readFileSync(path.join(__dirname,'..', 'buildToolsMinVersionCards-LWC.yaml'), 'utf8'));
            var minVersion = minVersions[this.vlocity.namespace]
            var currentVersion = this.vlocity.PackageVersion;
            if (minVersion && currentVersion && !(currentVersion >= minVersion)) {
                jobInfo.ignoreLWCActivationCards = true;
                VlocityUtils.error('Cards LWC Activation', 'Unsupported Managed package Version, LWC Activation disabled');
            }
            jobInfo.checkLWCActivationCards = true;
        }

        if (jobInfo.ignoreLWCActivationCards) {
            return;
        }

        const page = await this.vlocity.utilityservice.getPuppeteerPage(jobInfo);

        try {
                var idsArray = Object.keys(jobInfo.UILayoutsToCompile);
                for (let i = 0; i < idsArray.length; i++) {
                    var layoutId = idsArray[i];
                    var layoutKey = jobInfo.UILayoutsToCompile[layoutId];

                    var package = this.vlocity.namespacePrefix;
                    var siteUrl = this.vlocity.jsForceConnection.instanceUrl;

                    var pageCarddesignernew = siteUrl + '/apex/' + package + 'carddesignernew?id=' + layoutId + '&compile=true';

                    VlocityUtils.report('Starting LWC Activation for Classic Card',layoutKey);

                    VlocityUtils.verbose('LWC Card Compilation URL', pageCarddesignernew);
                    
                    const timeout = jobInfo.loginTimeoutForLoginLWC;
                    await Promise.all([ page.waitForNavigation(), page.goto(pageCarddesignernew, { timeout }) ]);
                    await page.waitForTimeout(5000);
                    
                    let tries = 0;
                    var errorMessage;
                    var maxNumOfTries = Math.ceil((60/jobInfo.defaultLWCPullTimeInSeconds)*jobInfo.defaultMinToWaitForLWCClassicCards);
                    while (tries < maxNumOfTries && !jobInfo.ignoreLWCActivationCards) {
                        try {
                            let message;
                            try {
                                message = await page.waitForSelector('#compileMessage');
                            } catch (messageTimeout) {
                                VlocityUtils.verbose('Error', messageTimeout);
                                VlocityUtils.log(dataPack.VlocityDataPackKey, 'Loading Page taking too long - Retrying - Tries: ' + tries + ' of ' + maxNumOfTries);
                            }
                            
                            if (message) { 
                                let currentStatus = await message.evaluate(node => node.innerText);
                                VlocityUtils.report('Activating Classic Card LWC', layoutKey, currentStatus);
                                jobInfo.elapsedTime = VlocityUtils.getTime();
                                VlocityUtils.report('Elapsed Time', jobInfo.elapsedTime);
                                if (currentStatus === 'DONE') {
                                    VlocityUtils.success('LWC Activated','LWC Activated for Card: ' + layoutKey);
                                    break;
                                } else if (/^No MODULE named markup/.test(currentStatus)) {
                                    var missingLWCTrimedError = currentStatus.substring('ERROR:'.length, currentStatus.indexOf('found :'));
                                    errorMessage = ' Missing Custom LWC - ' + missingLWCTrimedError;
                                    break;
                                } else if (/^ERROR/.test(currentStatus)) {
                                    errorMessage = ' Error Activating LWC - ' + currentStatus;
                                    break;
                                }
                            }
                        } catch (e) {
                            VlocityUtils.error('Error Activating LWC', layoutKey, e);
                            errorMessage = ' Error: ' + e;
                        }
                        tries++;
                        await page.waitForTimeout(jobInfo.defaultLWCPullTimeInSeconds*1000);
                    }

                    if (tries == maxNumOfTries) {
                        errorMessage = 'Activation took longer than ' + jobInfo.defaultMinToWaitForLWCClassicCards + ' minutes - Aborted';
                    }

                    if (errorMessage) {
                        jobInfo.hasError = true;
                        jobInfo.currentStatus[layoutKey] = 'Error';
                        jobInfo.currentErrors[layoutKey] = 'LWC Activation Error >> ' + layoutKey + ' - '+ errorMessage;
                        jobInfo.errors.push('LWC Activation Error >> ' + layoutKey  + ' - '+ errorMessage);
                        VlocityUtils.error('LWC Activation Error', layoutKey  + ' - '+ errorMessage);
                    }
                }
                jobInfo.UILayoutsToCompile =  {};
        } catch (e) {
            VlocityUtils.error(e);
        } finally {
            try { await page.close(); } catch (e) {}
        }
    }

}

VlocityUILayout.prototype.afterActivationSuccess = async function(inputMap) {
    var jobInfo = inputMap.jobInfo; 
    var dataPack = inputMap.dataPack;
    var clayoutSourceKey = dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityUILayout__c'][0].VlocityRecordSourceKey;
    var definition = dataPack.VlocityDataPackData['%vlocity_namespace%__VlocityUILayout__c'][0]['%vlocity_namespace%__Definition__c'];
    var isLWC = definition.includes('"enableLwc":true,');
    if (isLWC) {
        if (!jobInfo.UILayoutsToCompile) {
            jobInfo.UILayoutsToCompile =  {};
        }
        VlocityUtils.log('LWC for Classic Card will be compile at the end', dataPack.VlocityDataPackKey );
        jobInfo.UILayoutsToCompile[jobInfo.sourceKeyToRecordId[clayoutSourceKey]] = dataPack.VlocityDataPackKey;
    }
}
