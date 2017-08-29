"use strict";

var commander = require('commander');
var lib = require('./lib.js');
var path = require('path');

commander
    .version('0.0.1')
    .usage('<options>')
    .option('--upload <trace>', 'Process and upload the specified diagnostics trace directory.')
    .option('--download <trace>', 'Process and download the specified diagnostics trace.')
    .option('--remove <trace>', 'Remove the specified from the cloud if it exists.')
    .option('--list', 'List all of the traces currently in the cloud store.')
    .option('--compress <trace>', 'Compress the specified trace directory.')
    .option('--decompress <trace>', 'Remove the specified from the cloud if it exists.')
    .option('--location <location>', 'Specify the directory name to download a diagnostics trace.')
    .parse(process.argv);

if (commander.upload) {
    var traceDir = lib.ensureTraceDir(commander.upload);
    lib.processTraceUpload(traceDir, commander.location || detaultTraceFile);
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
else if (commander.list) {
    console.log('List is not implemented yet!!!');
}
else if (commander.compress) {
    var traceDir = lib.ensureTraceDir(commander.compress);
    if(!commander.location) {
        console.error('Must specify a location to write the trace using --location.')
    }

    lib.traceCompressorDirect(traceDir, commander.location, (err) => {
        if (err) {
            console.error('Failed with error: ' + err);
            process.exit(1);
        }
    });
}
else if (commander.decompress) {
    var traceDir = lib.ensureTraceTargetDir(commander.location);
    if (traceDir) {
        lib.traceDecompressorDirect(commander.decompress, traceDir, (err) => {
            if (err) {
                console.error('Failed with error: ' + err);
                process.exit(1);
            }
        });
    }
    else {
        console.error(`${commander.location} is not empty and does not look like an old trace location.`);
        console.error(`--Skipping download to avoid any accidental data loss.`)
    }
}
else {
    commander.help();
}


