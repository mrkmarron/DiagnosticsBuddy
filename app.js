"use strict";

var commander = require('commander');
var lib = require('./lib.js');

commander
    .version('0.0.1')
    .usage('<options>')
    .option('-u, --upload <trace>', 'Process and upload the specified diagnostics trace directory.')
    .option('-d, --download <trace>', 'Process and download the specified diagnostics trace.')
    .option('-l, --location <location>', 'Specify the directory name to download a diagnostics trace.')
    .option('-r, --remove <trace>', 'Remove the specified from the cloud if it exists.')
    .option('-p, --prepare <location>', 'Prepare the target location for launch with VSCode.')
    .parse(process.argv);

if (commander.upload) {
    var traceDir = lib.ensureTraceDir(commander.upload);
    lib.processTraceUpload(traceDir, commander.location);
}
else if (commander.download) {
    var remoteFileName = commander.download;
    var targetDir = lib.ensureTraceTargetDir(commander.location);
    if (targetDir) {
        lib.processTraceDownload(remoteFileName, targetDir);
    }
    else {
        console.error(`${commander.location} is not empty and does not look like an old trace location.`);
        console.error(`--Skipping download to avoid any accidental data loss.`)
    }
}
else if (commander.remove) {
    lib.processTraceRemove(commander.remove);
}
else if(commander.prepare) {
    var success = lib.processTraceInitializeForVSCode(commander.prepare);
    if(!success) {
        console.error(`${commander.prepare} does not look like a trace location.`);
        console.error(`--Skipping action to avoid any accidental data loss.`)
    }
}
else {
    commander.help();
}


