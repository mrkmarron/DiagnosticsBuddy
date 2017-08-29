"use strict";

var assert = require('assert');
var async = require('async');
var storage = require('azure-storage');
var fs = require('fs');
var path = require('path');
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

function uploadFileToAzure(localFile, remoteFile, callback) {
    var accessInfo = loadRemoteAccessInfo();
    if (!accessInfo) {
        callback(new Error('Failed to load Azure config.'));
    }
    else {
        var azureService = storage.createFileService(accessInfo.remoteUser, accessInfo.storageKey);
        azureService.createFileFromLocalFile(accessInfo.remoteShare, '', remoteFile, localFile, (err, res) => {
            callback(err);
        });
    }
}
exports.uploadFileToAzure = uploadFileToAzure;

function downloadFileFromAzure(remoteFile, localFile, callback) {
    var accessInfo = loadRemoteAccessInfo();
    if (!accessInfo) {
        callback(new Error('Failed to load Azure config.'));
    }
    else {
        var azureService = storage.createFileService(accessInfo.remoteUser, accessInfo.storageKey);
        azureService.getFileToLocalFile(accessInfo.remoteShare, '', remoteFile, localFile, (err, res) => {
            callback(err);
        });
    }
}
exports.downloadFileFromAzure = downloadFileFromAzure;

function removeFileFromAzure(remoteFile, callback) {
    var accessInfo = loadRemoteAccessInfo();
    if (!accessInfo) {
        callback(new Error('Failed to load Azure config.'));
    }
    else {
        var azureService = storage.createFileService(accessInfo.remoteUser, accessInfo.storageKey);
        azureService.deleteFileIfExists(accessInfo.remoteShare, '', remoteFile, (err) => {
            callback(err);
        });
    }
}
exports.removeFileFromAzure = removeFileFromAzure;

function listFilesFromAzure(callback) {
    var accessInfo = loadRemoteAccessInfo();
    if (!accessInfo) {
        callback(new Error('Failed to load Azure config.'));
    }
    else {
        var azureService = storage.createFileService(accessInfo.remoteUser, accessInfo.storageKey);
        azureService.listFilesAndDirectoriesSegmentedWithPrefix(accessInfo.remoteShare, '', '', null, (err, result) => {
            callback(err, result.files);
        });
    }
}
exports.listFilesFromAzure = listFilesFromAzure;

//////////////
//Compression functionality

const headerEntrySize = 32 + 32 + 32; //name startpos length\n

function traceCompressor(traceDir, targetFile, completeCallBack) {
    fs.readdir(traceDir, (direrr, compressFiles) => {
        if (direrr) { return completeCallBack(direrr); }

        const headerblockLength = 32 + compressFiles.length * headerEntrySize;
        let headerInfo = compressFiles.length.toString();
        while (headerInfo.length < 32 - 1) {
            headerInfo += ' ';
        }
        headerInfo += '\n';

        function extendHeader(file, startPos, length) {
            let hval = path.basename(file) + ' ' + startPos + ' ' + length;
            assert(hval.length < headerEntrySize - 1);

            while (hval.length < headerEntrySize - 1) {
                hval += ' ';
            }
            hval += '\n';

            headerInfo += hval;
        }

        function writeFinalHeaders(file, cb) {
            fs.open(targetFile, 'a', (wfherr, fd) => {
                if (wfherr) { return completeCallBack(wfherr); }

                const headerBuff = new Buffer(headerInfo);
                assert(headerBuff.length === headerInfo.length && headerInfo.length === headerblockLength);

                fs.write(fd, headerBuff, 0, headerBuff.length, 0, completeCallBack);
            });
        }

        let currentDataPos = headerblockLength;
        fs.writeFile(targetFile, new Buffer(headerblockLength), (ierr) => {
            if (ierr) { return completeCallBack(ierr); }

            function writeData(file, cb) {
                const inp = fs.createReadStream(file);
                const out = fs.createWriteStream(targetFile, { flags: "a" });

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
                    writeData(path.join(traceDir, file), cb);
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
exports.traceCompressor = traceCompressor;

function traceDecompressor(traceFile, targetDir, completeCallBack) {
    function extractHeaderInfo(cb) {
        fs.open(traceFile, 'r', (oerr, fd) => {
            if (oerr) { return completeCallBack(oerr); }

            const psizeBuff = new Buffer(32);
            fs.read(fd, psizeBuff, 0, psizeBuff.length, 0, (sizeerr, sizebytes, sizebuff) => {
                if (sizeerr) { return cb(sizeerr); }

                const headerblockCount = Number.parseInt(sizebuff.toString());
                if (headerblockCount === NaN) { return cb(new Error('Failed to parse header info')); }

                const headerblockLength = 32 + headerblockCount * headerEntrySize;
                const pheadersBuff = new Buffer(headerblockLength);
                fs.read(fd, pheadersBuff, 0, pheadersBuff.length, 0, (herr, headersBytes, headersBuff) => {
                    if (herr) { return cb(herr); }

                    const headersLines = headersBuff.toString().split('\n');
                    const headers = headersLines.slice(1, headersLines.length - 1).map((headerStr) => {
                        const components = headerStr.split(/\s+/);
                        const startNumber = Number.parseInt(components[1]);
                        const lengthNumber = Number.parseInt(components[2]);
                        if (startNumber === NaN || lengthNumber === NaN) { return cb(new Error('Failed to parse file entry.')); }

                        return { file: components[0], startOffset: startNumber, length: lengthNumber };
                    });

                    fs.close(fd, (cerr) => {
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

        const defl = zlib.createInflate();
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
exports.traceDecompressor = traceDecompressor;


