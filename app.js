"use strict";

var commander = require('commander');
var fs = require('fs');
var fsextra = require('fs-extra');
var lib = require('./lib.js');
var path = require('path');
var process = require('process');

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
    var traceDir = ensureTraceDir(commander.upload);
    processTraceUpload(traceDir, commander.location || detaultTraceFile);
}
else if (commander.download) {
    var remoteFileName = commander.download;
    var targetDir = ensureTraceTargetDir(commander.location);
    if (targetDir) {
        processTraceDownload(remoteFileName, targetDir);
    }
    else {
        console.error(`${commander.location} is not empty and does not look like an old trace location.`);
        console.error(`--Skipping download to avoid any accidental data loss.`)
    }
}
else if (commander.remove) {
    lib.removeFileFromAzure(commander.remove, (err) => {
        if(err) {
            console.error('Failed with error: ' + err);
            process.exit(1);
        }
    });
}
else if (commander.list) {
    lib.listFilesFromAzure((err) => {
        if(err) {
            console.error('Failed with error: ' + err);
            process.exit(1);
        }
    });
}
else if (commander.compress) {
    var traceDir = ensureTraceDir(commander.compress);
    if(!commander.location) {
        console.error('Must specify a location to write the trace using --location.')
    }

    lib.traceCompressor(traceDir, commander.location, (err) => {
        if (err) {
            console.error('Failed with error: ' + err);
            process.exit(1);
        }
    });
}
else if (commander.decompress) {
    var traceDir = ensureTraceTargetDir(commander.location);
    if (traceDir) {
        lib.traceDecompressor(commander.decompress, traceDir, (err) => {
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


////////////////////////////////

function dirLooksLikeTrace(trgtDir) {
    try {
        if (fs.existsSync(trgtDir)) {
            var contents = fs.readdirSync(trgtDir).filter((value) => !value.startsWith('.'));

            if (contents.length !== 0 && contents.indexOf('ttdlog.log') === -1) {
                //This doesn't look like an old trace directory!
                //We don't want to accidentally blow away user data.
                return false;
            }
        }
    } catch (ex) {
        return false;
    }

    return true;
}

//Ensure the trace dir looks like a TTD log dir.
function ensureTraceDir(traceDirName) {
    var dname = path.resolve(traceDirName);
    var lname = path.resolve(dname, 'ttdlog.log');
    if (fs.existsSync(dname) && fs.existsSync(lname)) {
        return dname;
    }
    else {
        if (!fs.existsSync(dname)) {
            console.error('Directory does not exist: ' + traceDirName);
        }
        else {
            console.error('Directory does not contain a diagnostics trace log: ' + traceDirName);
        }

        process.exit(1);
    }
}

//Create the target dir name we want to expand into and make sure it is ready to extract data into
function ensureTraceTargetDir(optTargetDirName) {
    var trgtDir = path.resolve(process.cwd(), '_tracelog' + path.sep);
    if (optTargetDirName) {
        trgtDir = path.resolve(optTargetDirName);
    }

    if (!dirLooksLikeTrace(trgtDir)) {
        return undefined;
    }

    fsextra.emptyDirSync(trgtDir);
    return trgtDir;
}

//Do the processing for the trace upload
function processTraceUpload(traceDirName, remoteName) {
    var tempfile = path.resolve(path.dirname(traceDirName), path.basename(traceDirName) + '_' + 'templog.trc');
    var remoteFile = remoteName || path.basename(traceDirName) + '.trc';

    var actionPipeline = [
        function (callback) {
            lib.traceCompressor(traceDirName, tempfile, callback);
        },
        function (callback) {
            lib.uploadFileToAzure(tempfile, remoteFile, callback);
        },
        function (callback) {
            //console.log('Deleting temp file: ' + tempfile);
            fs.unlink(tempfile, function (err) {
                //if it doesn't exist or something goes wrong that is fine just eat the error
                callback(null);
            });
        }
    ];

    async.series(actionPipeline, function (err, results) {
        if (err) {
            console.error('Upload failed with: ' + err);
            process.exit(1);
        }
        else {
            console.log('Upload succeeded.');
        }
    });
}

function processTraceDownload(remoteFileName, targetDir) {
    var tempfile = path.resolve(__dirname, "templog.trc");

    var actionPipeline = [
        function (callback) {
            lib.downloadFileFromAzure(path.basename(remoteFileName), tempfile, callback);
        },
        function (callback) {
            lib.traceDecompressor(tempfile, targetDir, callback);
        },
        function (callback) {
            //console.log('Deleting temp file: ' + tempfile);
            fs.unlink(tempfile, function (err) {
                //if it doesn't exist or something goes wrong that is fine just eat the error
                callback(null);
            });
        }
    ];

    async.series(actionPipeline, function (err, results) {
        if (err) {
            console.error('Download and process failed with: ' + err);
            process.exit(1);
        }
        else {
            console.log('Download and process succeeded.');
        }
    });
}
