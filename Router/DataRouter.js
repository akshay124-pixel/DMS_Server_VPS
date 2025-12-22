const express = require("express");
const DataLogic = require("../Controller/DataLogic");
const { verifyToken } = require("../utils/config jwt");
const router = express.Router();

router.post("/entry", verifyToken, DataLogic.DataentryLogic);
router.get("/fetch-entry", verifyToken, DataLogic.fetchEntries);
router.delete("/entry/:id", verifyToken, DataLogic.DeleteData);
router.put("/editentry/:id", verifyToken, DataLogic.editEntry);
router.get("/export", verifyToken, DataLogic.exportentry);
router.post("/entries", verifyToken, DataLogic.bulkUploadStocks);
router.get("/user-role", verifyToken, DataLogic.getAdmin);
router.get("/users", verifyToken, DataLogic.getUsers);
router.post("/send-email", verifyToken, DataLogic.sendEntryEmail);
module.exports = router;
