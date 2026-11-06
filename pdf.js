/**
 * Main function to automate the conversion of patient reports from Word to PDF.
 * Runs on a time-driven trigger.
 */
function convertReportsToPDF() {
  const reportsFolderId = "1-6ytxB54tuDzrnZ0spBBBn2SJ08Ve0EI";
  const fyFolderId      = "1sUPWFbL8RB00Yg6pkv13xVZy5snGzZ1q";
  const templateId      = "1HbUAZON59E_fRVw0bmHjbqkK9aAf_pJNGih5ZQeJGhg";
  const headerImageId   = "1Hc-eLFLT75u_6zZRb5XIkqNELMD2Lvhl";

  const sourceFolder = getYesterdayReportFolder(reportsFolderId, fyFolderId);
  if (!sourceFolder) {
    Logger.log("❌ No folder found for yesterday. Exiting.");
    return;
  }

  const files = sourceFolder.getFilesByType(MimeType.MICROSOFT_WORD);
  if (!files.hasNext()) {
    Logger.log("ℹ️ No Word docs found for yesterday.");
    return;
  }

  while (files.hasNext()) {
    const wordFile = files.next();
    try {
      const tempDocResource = {
        title: wordFile.getName().replace('.docx', ''),
        parents: [{ id: sourceFolder.getId() }]
      };
      const temporaryDoc   = Drive.Files.copy(tempDocResource, wordFile.getId(), { convert: true });
      const temporaryDocId = temporaryDoc.id;
      const sourceDocBody  = DocumentApp.openById(temporaryDocId).getBody();

      const templateFile   = DriveApp.getFileById(templateId);
      const newMergedDoc   = templateFile.makeCopy(wordFile.getName().replace('.docx', ''), sourceFolder);
      const newMergedDocId = newMergedDoc.getId();
      const newDoc         = DocumentApp.openById(newMergedDocId);
      const targetBody     = newDoc.getBody();

      targetBody.clear();

      try {
        const headerBlob = DriveApp.getFileById(headerImageId).getBlob();
        insertHeaderImage(newDoc, headerBlob);
      } catch (imgErr) {
        Logger.log("⚠️ Header image not inserted: " + imgErr.message);
      }

      for (let i = 0; i < sourceDocBody.getNumChildren(); i++) {
        const element = sourceDocBody.getChild(i).copy();
        const type    = element.getType();

        switch (type) {
          case DocumentApp.ElementType.PARAGRAPH:
            targetBody.appendParagraph(element);
            break;
          case DocumentApp.ElementType.TABLE:
            targetBody.appendTable(element);
            break;
          case DocumentApp.ElementType.LIST_ITEM:
            targetBody.appendListItem(element);
            break;
          default:
            Logger.log("Skipping unsupported element: " + type);
        }
      }

      newDoc.saveAndClose();
      const pdfBlob = newMergedDoc.getAs("application/pdf");
      pdfBlob.setName(wordFile.getName().replace(".docx", "") + ".pdf");
      sourceFolder.createFile(pdfBlob);

      Logger.log(`✅ Converted: ${wordFile.getName()} → PDF`);

      DriveApp.getFileById(temporaryDocId).setTrashed(true);
      DriveApp.getFileById(newMergedDocId).setTrashed(true);

    } catch (e) {
      Logger.log(`❌ Error converting '${wordFile.getName()}': ${e.message}`);
    }
  }
}

// -----------------------------------------------------------------------------

/**
 * Inserts a blob image into the document's header, setting it to full width
 * and flush with the top and side margins.
 * @param {DocumentApp.Document} doc The document object to modify.
 * @param {Blob} imageBlob The image data as a Blob.
 */
function insertHeaderImage(doc, imageBlob) {
  try {
    const header = doc.getHeader() || doc.addHeader();
    header.clear();

    const body = doc.getBody();

    // Store original margins to restore later
    const origTopMargin = body.getMarginTop();
    const origLeftMargin = body.getMarginLeft();
    const origRightMargin = body.getMarginRight();

    // Temporarily set margins to 0 for the full-width header image
    body.setMarginTop(0);
    body.setMarginLeft(0);
    body.setMarginRight(0);

    // Insert image and align it
    const imgParagraph = header.appendParagraph("");
    imgParagraph.appendInlineImage(imageBlob);
    imgParagraph.setAlignment(DocumentApp.HorizontalAlignment.LEFT);

    const img = imgParagraph.getChild(0);
    const natW = img.getWidth();
    const natH = img.getHeight();

    // Set image width to the full page width
    const pageWidth = body.getPageWidth();
    img.setWidth(pageWidth);
    img.setHeight(natH * (pageWidth / natW));

    // Restore original margins for the document body
    body.setMarginTop(origTopMargin);
    body.setMarginLeft(origLeftMargin);
    body.setMarginRight(origRightMargin);

    Logger.log("✅ Header image inserted as full-width header.");
  } catch (err) {
    throw new Error("Could not insert header image: " + err.message);
  }
}

// -----------------------------------------------------------------------------

/**
 * Locates yesterday’s report folder.
 */
function getYesterdayReportFolder(reportsFolderId, fyFolderId) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const monthName = Utilities.formatDate(yesterday, Session.getScriptTimeZone(), "MMMM");
  const day       = Utilities.formatDate(yesterday, Session.getScriptTimeZone(), "dd");

  try {
    const reportsFolder = DriveApp.getFolderById(reportsFolderId);
    const fyFolders     = reportsFolder.getFoldersByName("FY 2025");
    if (fyFolders.hasNext()) {
      const fyFolder     = fyFolders.next();
      const monthFolders = fyFolder.getFoldersByName(monthName);
      if (monthFolders.hasNext()) {
        const monthFolder = monthFolders.next();
        const dayFolders  = monthFolder.getFoldersByName(day);
        if (dayFolders.hasNext()) return dayFolders.next();
      }
    }
    return null;
  } catch (e) {
    Logger.log("❌ Error locating yesterday’s folder: " + e.message);
    return null;
  }
}