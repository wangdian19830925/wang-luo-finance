/**
 * 数据库写入模块（宏观趋势专用）
 */

const { COLLECTIONS, DOC_IDS } = require('../../shared/constants');

/**
 * 写入宏观趋势数据到 macro_trends_cloud 集合
 * 固定文档 ID: latest_macro
 */
async function writeMacroData(db, macroData) {
  const collection = db.collection(COLLECTIONS.MACRO_TRENDS);
  const docData = {
    _id: DOC_IDS.LATEST_MACRO,
    ...macroData,
    updatedAt: new Date().toISOString(),
  };

  try {
    try {
      await collection.doc(DOC_IDS.LATEST_MACRO).set(docData);
      console.log('[macro-db] 宏观数据写入成功 (set)');
    } catch (setErr) {
      try {
        await collection.add(docData);
        console.log('[macro-db] 宏观数据写入成功 (add)');
      } catch (addErr) {
        await collection.doc(DOC_IDS.LATEST_MACRO).update(macroData);
        console.log('[macro-db] 宏观数据写入成功 (update)');
      }
    }
  } catch (e) {
    console.error('[macro-db] 宏观数据写入失败:', e.message);
    throw e;
  }
}

module.exports = { writeMacroData };
