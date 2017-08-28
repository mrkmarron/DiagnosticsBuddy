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

const headerEntrySize = 32 + 32 + 32; //name startpos length\n

function traceCompressor(traceDir, targetFile, completeCallBack) {
    fs.readdir(traceDir, (direrr, compressFiles) => {
        if (direrr) { return completeCallBack(direrr); }

        const headerblockLength = 32 + compressFiles.length * headerEntrySize;
        let headerInfo = compressFiles.length.toString();
        while (headerInfo.length < 32) {
            headerInfo += ' ';
        }
        headerInfo += '\n';

        function extendHeader(file, startPos, length) {
            hval = file + ' ' + startPos + ' ' + length;
            assert(hval < headerEntrySize);

            while (hval.length < headerEntrySize) {
                hval += ' ';
            }
            hval += '\n';

            headerInfo += hval;
        }

        function writeFinalHeaders(file, cb) {
            fs.open(targetFile, 'a', (wfherr, fd) => {
                if (wfherr) { return completeCallBack(wfherr); }

                const headerBuff = new Buffer(headerInfo);
                fs.write(fd, headerBuff, completeCallBack);
            });
        }

        let currentDataPos = headerblockLength;
        fs.writeFile(targetFile, new Buffer(headerblockLength), (ierr) => {
            if (ierr) { return completeCallBack(ierr); }

            function writeData(file, cb) {
                const inp = fs.createReadStream(file);
                const out = fs.createWriteStream(outFile, { flags: "a" });

                out.on('close', () => {
                    extendHeader(file, currentDataPos, out.bytesWritten);
                    currentDataPos += out.bytesWritten;
                    cb(null);
                });
                out.on('error', (perr) => {
                    cb(perr);
                });

                const defl = zlib.createDeflate();
                inp.pipe(defl).pipe(out);
            }

            const filecbArray = compressFiles.map((file) => {
                return function (cb) {
                    writeData(file, cb);
                }
            });

            async.series(
                filecbArray,
                function (err) {
                    if (err) { return completeCallBack(err); }

                    writeFinalHeaders(targetFile, completeCallBack);
                }
            );
        });
    });
}
exports.traceCompressorDirect = traceCompressor;

//Run compression of trace dir into temp file
function logCompress(targetFile, traceDirName) {
    console.log('Compressing ' + traceDirName + ' into: ' + targetFile);

    var zipcmd = `node ${dirname}${path.sep}app.js -compress ${traceDirName} -into ${targetFile}`;
    var startTime = new Date();
    childProcess.exec(zipcmd, { env: { DO_TTD_RECORD: 0 } }, (err) => {
        console.log(`Compress complete in ${(new Date() - startTime) / 1000}s.`);

        if(err) {
            console.error('Failed with error: ' + err); 
        }
    });
}
exports.logCompressExecAsync = logCompress;

function traceDecompressor(traceFile, targetDir, completeCallBack) {
    function extractHeaderInfo(cb) {
        fs.open(traceFile, 'r', (oerr, fd) => {
            if (oerr) { return completeCallBack(oerr); }

            const psizeBuff = new Buffer(32);
            fs.read(fd, psizeBuff, 0, psizeBuff.length, 0, (sizeerr, sizebytes, sizebuff) => {
                if (sizeerr) { return cb(sizeerr); }

                const headerblockLength = Number.parseInt(sizebuff.toString());
                if (headerblockLength === NaN) { return cb(new Error('Failed to parse header info')); }

                const pheadersBuff = new Buffer(headerblockLength);
                fs.read(fd, pheadersBuff, 0, pheadersBuff.length, 0, (herr, headersBytes, headersBuff) => {
                    if (herr) { return cb(herr); }

                    const headers = headersBuff.toString().split('\n').shift().map((headerStr) => {
                        const components = headerStr.split(/\s+/);
                        return { file: components[0], startOffset: components[1], length: components[2] };
                    });

                    fs.close(fs, (cerr) => {
                        if (sizeerr) { return cb(cerr); }
                        cb(null, headers);
                    });
                });
            });
        });
    }

    function extractFile(headerInfo, cb) {
        const inp = fs.createReadStream(traceFile, { start: headerInfo.startOffset, end: headerInfo.startOffset + headerInfo.length - 1 });
        const out = fs.createWriteStream(path.join(targetDir, headerInfo.file));

        out.on('close', () => {
            cb(null);
        });
        out.on('error', (perr) => {
            cb(perr);
        });

        const defl = zlib.createDeflate();
        inp.pipe(defl).pipe(out);
    }

    extractHeaderInfo((err, headers) => {
        const filecbArray = headers.map((header) => {
            return function (cb) {
                extractFile(header, cb);
            }
        });

        async.series(
            filecbArray,
            function (err) {
                return completeCallBack(err);
            }
        );
    });
}
exports.traceDecompressorDirect = traceDecompressor;

function logDecompress(traceFile, traceDirName) {
    console.log('Decompressing ' + traceFile + ' into: ' + traceDirName);

    var unzipcmd = `node ${dirname}${path.sep}app.js -uncompress ${targetFile} -into ${traceDirName}`;
    var startTime = new Date();
    childProcess.exec(unzipcmd, { env: { DO_TTD_RECORD: 0 } }, (err) => {
        console.log(`Decompress complete in ${(new Date() - startTime) / 1000}s.`);

        if(err) {
            console.error('Failed with error: ' + err); 
        }
    });
}
exports.logDecompressExecAsync = logDecompress;

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
