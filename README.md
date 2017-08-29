# DiagnosticsBuddy
A set of utilities to help manage diagnostic traces produced by NodeChakraCore. 

## Command line facilities
The DiagnosticBuddy utilities can be run as command line helpers via `app.js` which supports the following operations:
  * `--upload <trace> [--location <remotefile>]`   Process and upload the specified diagnostics trace `remotefile` or uses the trace name if no explicit location is provided.
  * `--download <remotefile> [--location <trace>]` Process and download the specified diagnostics trace `remotefile` and places the result in `trace` or into `./_tracelog` if no explicit location is provided.
  * `--remove <remotefile>`                        Remove the specified from the cloud if it exists.
  * `--list`                                       List all of the remotefile traces currently in the cloud store.
  * `--compress <trace> [--location <localfile>]`  Compress the specified trace into the specified `localfile` or uses the `trace` name if no explicit location is provided.
  * `--decompress <localfile> [--location <trace>]`Decompress the specified `localfile` trace into the specified `trace` location or into `./_tracelog` if no explicit location is provided.

## TTD integration
The DiagnosticBuddy utilities can be `required` in your app to enable the automatic upload of TTD traces to a specified Azure file share.
`require(diagnostic-buddy).enableAzureUploads();`

You must also add a file called `azureconfig.json` into the `diagnostics-buddy` code directory with the format:
```
{
    "remoteShare": "[Your remote file share name here]",
    "remoteUser":  "[Your remote user name here]",
    "storageKey":  "[Your remote storage key here]"
}
```
