export function nativeExportDownloadPayload({ localRequest, exportedPath, download, responseData }) {
  const downloadLines = `Download: ${download.fileName}\nOpen it in your browser when prompted.\nOpen URL: ${download.openUrl || download.url}\nDownload URL: ${download.url}\nLink expires: ${download.expiresAt}`;
  return {
    status: "succeeded",
    level: "info",
    message: localRequest
      ? `Exported current session to HTML.\nSaved to: ${exportedPath}\n${downloadLines}`
      : `Exported current session to HTML.\n${downloadLines}`,
    ...(localRequest ? { serverPath: exportedPath, result: responseData } : {}),
    download,
    refresh: ["state"],
  };
}
