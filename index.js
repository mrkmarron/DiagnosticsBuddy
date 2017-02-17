"use strict";

var path = require('path');
var process = require('process');
var childProcess = require('child_process');

function uploadTraceSync(resolvedPath) {
    try {
        var tracename = path.basename(resolvedPath) + '.trc';
        process.stderr.write(`    Uploading ${resolvedPath} to ${tracename} in Azure storage (Sync).\n`);
        var cmd = `node.exe ${path.resolve(__dirname, 'app.js')} -u ${resolvedPath}`;
        childProcess.execSync(cmd);

        process.stderr.write(`Completed upload of ${resolvedPath}\n`);
    }
    catch (ex) {
        process.stderr.write(`    Faild to write error trace -- ${ex}\n`);
    }
}

function uploadTraceAsync(resolvedPath) {
    try {
        var tracename = path.basename(path.dirname(resolvedPath)) + '_' + path.basename(resolvedPath) + '.trc'
        process.stderr.write(`    Uploading ${resolvedPath} to ${tracename} in Azure storage (Async).\n`);
        var cmd = `node.exe ${path.resolve(__dirname, 'app.js')} -u ${resolvedPath} -l ${tracename}`;
        childProcess.exec(cmd, function (err, stdout, stderr) {
            if (err) {
                process.stderr.write(`Failed to upload ${cmd} -- err is ${err} stderr is ${stderr} stdout is ${stdout}\n`);
                process.exit(1);
            }

            process.stderr.write(`Completed upload of ${resolvedPath}\n`);
        });
    }
    catch (ex) {
        process.stderr.write(`    Faild to write error trace -- ${ex}\n`);
    }
}

exports.AzureManager = {
"uploadTraceSync": uploadTraceSync,
"uploadTraceAsync": uploadTraceAsync
};
