"use strict";

var async = require('async');
var childProcess = require('child_process');
var storage = require('azure-storage');
var console = require('console');
var fs = require('fs');
var fsextra = require('fs-extra');
var path = require('path');
var process = require('process');
var zlib = require('zlib');

//////////////
//Shared functionality

function loadRemoteAccessInfo() {
    var res = undefined;
    try {
        res = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'azureconfig.json')));
    }
    catch (ex) {
        ;
    }

    return res;
}

function dirLooksLikeTrace(trgtDir) {
    try {
        if (fs.existsSync(trgtDir)) {
            var contents = fs.readdirSync(trgtDir);
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

function uploadFileToAzure(localFile, remoteFile, callback) {
    console.log('Uploading data to ' + remoteFile + ' from ' + localFile);

    var accessInfo = loadRemoteAccessInfo();
    if (!accessInfo) {
        callback(new Error('Failed to load Azure config.'));
    }
    else {
        var azureService = storage.createFileService(accessInfo.remoteUser, accessInfo.storageKey);
        azureService.createFileFromLocalFile('cloud-traces', '', remoteFile, localFile, (err, res) => {
            callback(err);
        });
    }
}

function downloadFileFromAzure(remoteFile, localFile, callback) {
    console.log('Downloading data from ' + remoteFile + ' to ' + localFile);

    var accessInfo = loadRemoteAccessInfo();
    if (!accessInfo) {
        callback(new Error('Failed to load Azure config.'));
    }
    else {
        var azureService = storage.createFileService(accessInfo.remoteUser, accessInfo.storageKey);
        azureService.getFileToLocalFile('cloud-traces', '', remoteFile, localFile, (err, res) => {
            callback(err);
        });
    }
}

function removeFileFromAzure(remoteFile, callback) {
    console.log('Removing file from ' + remoteFile);

    var accessInfo = loadRemoteAccessInfo();
    if (!accessInfo) {
        callback(new Error('Failed to load Azure config.'));
    }
    else {
        var azureService = storage.createFileService(accessInfo.remoteUser, accessInfo.storageKey);
        azureService.deleteFileIfExists('cloud-traces', '', remoteFile, (err) => {
            callback(err);
        });
    }
}

//////////////
//Compression functionality

const emptySizeString = '                ';

function reserveEntryHeader(file, filesize, outFD, cb) {
    const filesizeString = filesize.toString();
    if (filesizeString.length > emptySizeString.length) { cb(new Error('File is too large to process.')); }

    const wstr = path.basename(file) + '@' + emptySizeString + '#';
    fs.write(outFD, wstr, cb);
}

function writeEntryHeader(file, compressedSize, offset, outFD, cb) {
    const wstr = path.basename(file) + '@' + compressedSize + '#';
    fs.write(outFD, wstr, offset, cb);
}

function writeEntryData(file, outFD, origOffset, cb) {
    let writtenLength = headerLength;
    fs.stat(file, (serr, stats) => {
        if (serr) { cb(serr); }

        fs.open(file, "r", (oerr, inFD) => {
            if (oerr) { cb(oerr); }

            let processingInfo = { filesize: stats.size, remainingsize: stats.size, compressedsize: 0 };
            let buffer = new Buffer(1024);
            async.whilst(
                () => { return processingInfo.remainingsize > 0; },
                (pcb) => { writeBlock(inFD, outFD, buffer, processingInfo, pcb); },
                (err) => { writeEntryHeader(file, processingInfo.compressedsize, origOffset, outFD, cb); }
            );
        });
    });
}

function writeBlock(inFD, outFD, buffer, processingInfo, cb) {
    fs.read(inFD, buffer, 0, buffer.length, (rerr, readLength) => {
        if (rerr) { cb(rerr); }

        zlib.deflate(buffer, (zerr, cbuffer) => {
            fs.write(outFD, cbuffer, 0, cbuffer.length, (werr, writtenLength) => {
                if (werr) { cb(werr); }
                if (cbuffer.length !== writtenLength) { cb(new Error('Read and write lengths are different!')); }

                processingInfo.remainingsize -= readLength;
                processingInfo.compressedsize += writtenLength;

                cb(null);
            });
        });
    });
}

function addSingleFileToOutput(file, outFD, cb) {
    fs.fstat(outFD, (fserr, fstats) => {
        if (fserr) { cb(fserr); }

        let origOffset = fstats.size;
        fs.stat(file, (serr, stats) => {
            if (serr) { cb(serr); }

            reserveEntryHeader(file, stats.size, outFD, (err) => {
                writeEntryData(file, outFD, origOffset, cb);
            });
        });
    });
}

function compressTrace(traceDir, targetFile) {
    fs.readdir(traceDir, (derr, files) => {
        if (derr) {
            console.error('Failed to read directory contents: ' + derr);
            process.exit(1);
        }

        fs.open(targetFile, "w", (oerr, fd) => {
            if (oerr) {
                console.error('Failed to open output file: ' + oerr);
                process.exit(1);
            }

            let fileOffset = 0;
            const filecbArray = files.map((file) => {
                return function (cb) {
                    addSingleFileToOutput(file, fd, cb);
                }
            });

            async.series(
                filecbArray,
                function (err) {
                    outStream.close();
                    if (err) {
                        console.error('Failed to read directory contents: ' + err);
                        process.exit(1);
                    }

                    console.log('All files compressed into output.');
                    process.exit(0)
                }
            );
        });
    });
}

//Run compression of trace dir into temp file
function logCompress(targetFile, traceDirName, callback) {
    console.log('Compressing ' + traceDirName + ' into: ' + targetFile);

    var zipcmd = `node ${dirname}${path.sep}app.js -compress ${traceDirName} -into ${targetFile}`;
    var startTime = new Date();
    childProcess.exec(zipcmd, { cwd: traceDirName, env: {DO_TTD_RECORD: 0} }, (err) => {
        console.log(`Compress complete in ${(new Date() - startTime) / 1000}s.`);

        callback(err);
    });
}
exports.logCompress = logCompress;

function logDecompress(traceFile, traceDirName, callback) {
    console.log('Decompressing ' + traceFile + ' into: ' + traceDirName);

    var unzipcmd = buildUnZipCmd(traceFile, traceDirName);
    if (!unzipcmd) {
        callback("Failed to zip trace", null);
    }
    else {
        var startTime = new Date();
        var err = null;
        try {
            childProcess.execSync(unzipcmd);
            console.log(`Decompress complete in ${(new Date() - startTime) / 1000}s.`);
        }
        catch (ex) {
            err = ex;
        }

        callback(err);
    }
}

//////////////
//Upload functionality

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
exports.ensureTraceDir = ensureTraceDir;

//Do the processing for the trace upload
function processTraceUpload(traceDirName, remoteName) {
    var tempfile = path.resolve(path.dirname(traceDirName), path.basename(traceDirName) + '_' + 'templog.trc');
    var remoteFile = remoteName || path.basename(traceDirName) + '.trc';

    var actionPipeline = [
        function (callback) {
            logCompress(tempfile, traceDirName, callback);
        },
        function (callback) {
            uploadFileToAzure(tempfile, remoteFile, callback);
        },
        function (callback) {
            console.log('Deleting temp file: ' + tempfile);
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
exports.processTraceUpload = processTraceUpload;

//////////////
//Download functionality

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
exports.ensureTraceTargetDir = ensureTraceTargetDir;

//copy the contents of the resources folder into the target dir
function copyReplayDebugResources(targetDir, callback) {
    var resourcespath = path.resolve(__dirname, 'resources');
    var resourcestarget = path.resolve(targetDir);

    console.log(`Copying resources from ${resourcespath} to ${resourcestarget}`);
    fsextra.copy(resourcespath, resourcestarget, function (err) {
        if (err) {
            console.error(`Failed to copy resources from ${resourcespath} to ${resourcestarget}`);
        }

        callback(err);
    });
}

function processTraceDownload(remoteFileName, targetDir) {
    var tempfile = path.resolve(__dirname, "templog.trc");

    var actionPipeline = [
        function (callback) {
            downloadFileFromAzure(path.basename(remoteFileName), tempfile, callback);
        },
        function (callback) {
            logDecompress(tempfile, targetDir, callback);
        },
        function (callback) {
            copyReplayDebugResources(targetDir, callback);
        },
        function (callback) {
            console.log('Deleting temp file: ' + tempfile);
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
exports.processTraceDownload = processTraceDownload;

//////////////
//Remove and Setup folder functionality

function processTraceRemove(traceName) {
    removeFileFromAzure(traceName, function (err) {
        if (!err) {
            console.log('Remove succeeded.');
        }
    });
}
exports.processTraceRemove = processTraceRemove;

function processTraceInitializeForVSCode(traceName) {
    if (!dirLooksLikeTrace(traceName)) {
        return false;
    }

    var actionPipeline = [
        function (callback) {
            copyReplayDebugResources(traceName, callback);
        }
    ];

    async.series(actionPipeline, function (err, results) {
        if (err) {
            console.error('Initialize trace directory for VSCode launch failed with: ' + err);
            process.exit(1);
        }
        else {
            console.log('Initialize trace directory for VSCode launch succeeded.');
        }
    });

    return true;
}
exports.processTraceInitializeForVSCode = processTraceInitializeForVSCode;