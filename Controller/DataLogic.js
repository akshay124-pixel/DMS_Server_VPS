const mongoose = require("mongoose");
const Entry = require("../Schema/DataModel");
const User = require("../Schema/Model");
const XLSX = require("xlsx");
const { sendMail } = require("../utils/mailer");

const { setcache, deleteCache, getCachedData, clearAllCache } = require("../Middleware/CacheMidddleware");
// DataentryLogic - Create a single entry   
const DataentryLogic = async (req, res) => {
  try { 
    const {
      customerName,
      contactName,
      mobileNumber,
      AlterNumber,
      email,
      address,
      state,
      city,
      product,
      organization,
      category,
      status,
      remarks,
      estimatedValue,
    } = req.body;

    // Basic 
    const newEntry = new Entry({
      customerName: customerName.trim(),
      mobileNumber: mobileNumber.trim(),
      contactName: contactName.trim(),
      AlterNumber: AlterNumber.trim(),
      email: email.trim(),
      address: address.trim(),
      product: product.trim(),
      state: state ? state.trim() : "",
      city: city ? city.trim() : "",
      organization: organization.trim(),
      category: category.trim(),
      createdBy: req.user.id,
      ...(status && { status }),
      ...(remarks && { remarks: remarks.trim() }),
      ...(estimatedValue && {
        estimatedValue: parseFloat(estimatedValue) || null,
      }),
      history:
        status && remarks
          ? [
              {
                status,
                remarks: remarks.trim(),
                timestamp: new Date(),
              },
            ]
          : [],
    });

    await newEntry.save();
    // Clear ALL cache so new entry shows for Admin/Superadmin too
    clearAllCache();

    res.status(201).json({
      success: true,
      data: newEntry,
      message: "Entry created successfully.",
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Some inputs are incorrect. Please check and try again.",
        errors: messages,
      });
    }
    console.error("Error in DataentryLogic:", error.message);
    res.status(500).json({
      success: false,
      message:
        "Oops! Something went wrong on our side. Please try again later.",
      error: error.message,
    });
  }
};


// Get Users
const getUsers = async (req, res) => {
  try {
    const normalizeRole = (role) =>
      role
        ? role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()
        : "Others";
    const userRole = normalizeRole(req.user.role);
    console.log("getUsers: User ID:", req.user.id, "Role:", userRole);

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({
        success: false,
        errorCode: "INVALID_USER_ID",
        message: "Invalid user ID in token",
      });
    }

    let users;
    if (userRole === "Superadmin" || userRole === "Admin") {
      users = await User.find().select("_id username role").lean();
    } else {
      users = await User.find({ _id: req.user.id })
        .select("_id username role")
        .lean();
    }

    if (!users.length) {
      console.warn("No users found for role:", userRole);
      return res.status(404).json({
        success: false,
        errorCode: "NO_USERS_FOUND",
        message: "No users found.",
      });
    }

    const normalizedUsers = users.map((user) => ({
      _id: user._id.toString(),
      username: user.username || "Unknown",
      role: normalizeRole(user.role),
    }));

    console.log(
      "Returning users:",
      normalizedUsers.length,
      normalizedUsers.map((u) => ({ _id: u._id, role: u.role }))
    );
    res.status(200).json({
      success: true,
      data: normalizedUsers,
    });
  } catch (error) {
    console.error("getUsers Error:", error.message);
    res.status(500).json({
      success: false,
      errorCode: "SERVER_ERROR",
      message:
        "We couldn't retrieve the user list right now. Please try again later.",
      error: error.message,
    });
  }
};
// exportentry - Export entries to XLSX (filtered by role)
const exportentry = async (req, res) => {
  try {
    const normalizedRole =
      req.user.role.charAt(0).toUpperCase() +
      req.user.role.slice(1).toLowerCase();
    
    let entries;
    if (normalizedRole === "Admin" || normalizedRole === "Superadmin") {
      entries = await Entry.find().lean();
    } else {
      entries = await Entry.find({ createdBy: req.user.id }).lean();
    }

    const formattedEntries = entries.map((entry) => ({
      customerName: entry.customerName,
      contactName: entry.contactName,
      mobileNumber: entry.mobileNumber,
      AlterNumber: entry.AlterNumber,
      email: entry.email,
      address: entry.address,
      state: entry.state,
      city: entry.city,
      product: entry.product,
      organization: entry.organization,
      category: entry.category,
      status: entry.status || "Not Found",
      createdAt: entry.createdAt.toLocaleDateString(),

      remarks: entry.remarks || "Not Found",
    }));

    const ws = XLSX.utils.json_to_sheet(formattedEntries);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customer Entries");

    const fileBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Disposition", "attachment; filename=entries.xlsx");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(fileBuffer);
  } catch (error) {
    console.error("Error exporting entries:", error.message);
    res.status(500).json({
      success: false,
      message: "Error exporting entries",
      error: error.message,
    });
  }
};

// fetchEntries - Fetch entries based on role

const fetchEntries = async (req, res) => {
  try {
    const normalizedRole =
      req.user.role.charAt(0).toUpperCase() +
      req.user.role.slice(1).toLowerCase();
    console.log("fetchEntries: User ID:", req.user.id, "Role:", normalizedRole);

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({
        success: false,
        errorCode: "INVALID_USER_ID",
        message:
          "The user ID provided in your session is invalid. Please log out and log back in.",
      });
    }
    const cacheKey = normalizedRole === "Admin" || normalizedRole === "Superadmin"
    ? "entries_all" : `entries_user_${req.user.id}`;

    // Check cache directly
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      return res.json({
        success: true,
        data: cachedData,
        message: "Data fetched from cache"
      });
    }

    let entries;
    if (normalizedRole === "Admin" || normalizedRole === "Superadmin") {
      entries = await Entry.find().populate("createdBy", "username _id").lean();
    } else {
      entries = await Entry.find({ createdBy: req.user.id })
        .populate("createdBy", "username _id")
        .lean();
    }

    const normalizedEntries = entries.map((entry) => ({
      ...entry,
      _id: entry._id.toString(),
      createdBy: {
        _id: entry.createdBy?._id?.toString() || null,
        username: entry.createdBy?.username || "Unknown",
      },
    }));

    console.log(
      "Fetched entries count:",
      normalizedEntries.length,
      "User roles:",
      [
        ...new Set(
          normalizedEntries.map((e) => e.createdBy?.username || "Unknown")
        ),
      ]
    );

    setcache(cacheKey, normalizedEntries, 300); // Cache for 5 minutes
    res.status(200).json({
      success: true,
      data: normalizedEntries,
    });
  } catch (error) {
    console.error("Error fetching entries:", error.message);
    res.status(500).json({
      success: false,
      errorCode: "SERVER_ERROR",
      message:
        "We couldn’t retrieve your entries at the moment. Please try again later.",
      error: error.message,
    });
  }
};

// DeleteData

const DeleteData = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message:
          "The entry ID you provided is not valid. Please check and try again.",
      });
    }

    const entry = await Entry.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({
        success: false,
        message:
          "We could not find the entry you are trying to delete. It might have already been removed.",
      });
    }

    const normalizedRole =
      req.user.role.charAt(0).toUpperCase() +
      req.user.role.slice(1).toLowerCase();

    if (normalizedRole !== "Admin" && normalizedRole !== "Superadmin") {
      if (!entry.createdBy || entry.createdBy.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to delete this entry. Please contact your administrator if you think this is a mistake.",
        });
      }
    }

    // Delete the entry
    await Entry.findByIdAndDelete(req.params.id);

    // Clear ALL cache to ensure deleted data is removed for everyone
    // This is important when Admin/Superadmin deletes another user's entry
    clearAllCache();

    res.status(200).json({
      success: true,
      message: "Entry has been deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting entry:", error.message);
    res.status(500).json({
      success: false,
      message:
        "We ran into an issue while trying to delete the entry. Please try again later or contact support.",
      error: error.message,
    });
  }
};
// editEntry - Update an entry (only if created by user or admin)
const editEntry = async (req, res) => {
  try {
    const {
      customerName,
      contactName,
      mobileNumber,
      AlterNumber,
      email,
      address,
      state,
      city,
      product,
      organization,
      category,
      status,
      remarks,
      closetype,
      closeamount,
      estimatedValue,
    } = req.body;

    console.log("Incoming payload:", req.body);

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message:
          "The entry ID provided is not valid. Please check and try again.",
      });
    }

    const entry = await Entry.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({
        success: false,
        message:
          "We could not find the entry you are trying to update. It might have been deleted.",
      });
    }

    const normalizedRole =
      req.user.role.charAt(0).toUpperCase() +
      req.user.role.slice(1).toLowerCase();
    if (
      normalizedRole !== "Admin" &&
      normalizedRole !== "Superadmin" &&
      entry.createdBy.toString() !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message:
          "You do not have permission to update this entry. Please contact your administrator if you believe this is an error.",
      });
    }

   

    const updateData = {
      ...(customerName !== undefined && {
        customerName: customerName.trim() || entry.customerName,
      }),
      ...(contactName !== undefined && {
        contactName: contactName.trim() || entry.contactName,
      }),
      ...(mobileNumber !== undefined && {
        mobileNumber: mobileNumber.trim() || entry.mobileNumber,
      }),
      ...(AlterNumber !== undefined && {
        AlterNumber: AlterNumber.trim() || entry.AlterNumber,
      }),
      ...(email !== undefined && { email: email.trim() || entry.email }),
      ...(address !== undefined && {
        address: address.trim() || entry.address,
      }),
      ...(state !== undefined && { state: state.trim() || "" }),
      ...(city !== undefined && { city: city.trim() || "" }),
      ...(product !== undefined && {
        product: product.trim() || entry.product,
      }),
      ...(organization !== undefined && {
        organization: organization.trim() || entry.organization,
      }),
      ...(category !== undefined && {
        category: category.trim() || entry.category,
      }),
      ...(status !== undefined && { status }),
      ...(remarks !== undefined && { remarks: remarks ? remarks.trim() : "" }),
      ...(estimatedValue !== undefined && {
        estimatedValue: parseFloat(estimatedValue) || null,
      }),
      updatedAt: new Date(),
    };

    // Track any update to the entry for history
    const hasUpdates = Object.keys(updateData).length > 1; 
    if (hasUpdates) {
      updateData.$push = {
        history: {
          status: status !== undefined ? status : entry.status,
          remarks: remarks !== undefined ? remarks.trim() : "",
          timestamp: new Date(),
        },
      };
    }

    if (status === "Closed") {
      if (
        !closetype ||
        !["Closed Won", "Closed Lost"].includes(closetype.trim())
      ) {
        return res.status(400).json({
          success: false,
          message:
            "When closing an entry, please specify if it is 'Closed Won' or 'Closed Lost'.",
        });
      }
      updateData.closetype = closetype.trim();
      updateData.closeamount = parseFloat(closeamount) || null;
    } else {
      updateData.closetype = "";
      updateData.closeamount = null;
    }

    console.log("Update data:", updateData);

    const updatedEntry = await Entry.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    ).lean();

    // Clear ALL cache to ensure updated data shows for everyone
    clearAllCache();


    res.status(200).json({
      success: true,
      data: updatedEntry,
      message: "Entry updated successfully.",
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      console.error("Validation errors:", messages);
      return res.status(400).json({
        success: false,
        message:
          "Some fields contain invalid data. Please review your inputs and try again.",
        errors: messages,
      });
    }
    console.error("Error in editEntry:", error.message);
    res.status(500).json({
      success: false,
      message:
        "We encountered an error while updating your entry. Please try again later or contact support if the problem persists.",
      error: error.message,
    });
  }
};

// bulkUploadStocks - Bulk upload entries
const bulkUploadStocks = async (req, res) => {
  try {
    const newEntries = req.body;

    if (!Array.isArray(newEntries) || newEntries.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "The uploaded data is not in the correct format. Please upload a list of entries.",
      });
    }

    // Helper function to sanitize phone numbers (extract only digits, take last 10)
    const sanitizePhone = (phone) => {
      if (!phone) return "";
      const digits = String(phone).replace(/\D/g, ""); // Remove all non-digits
      if (digits.length === 0) return "";
      if (digits.length >= 10) return digits.slice(-10); // Take last 10 digits
      return ""; // Invalid if less than 10 digits
    };

    // Map entries to match the export format exactly
    const validatedEntries = newEntries.map((entry) => {
      const createdAt = new Date();
      const updatedAt = new Date();

      return {
        customerName: String(entry["Customer Name"] || "").trim(),
        contactName: String(entry["Contact Person"] || "").trim(),
        email: String(entry["Email"] || "").trim().toLowerCase(),
        mobileNumber: sanitizePhone(entry["Contact Number"]),
        AlterNumber: sanitizePhone(entry["Alternate Number"]),
        product: String(entry["Product"] || "").trim(),
        address: String(entry["Address"] || "").trim(),
        organization: String(entry["Organization"] || "").trim(),
        category: String(entry["Category"] || "").trim(),
        city: String(entry["District"] || "").trim(),
        state: String(entry["State"] || "").trim(),
        status: entry["Status"] || "Not Found",
        remarks: String(entry["Remarks"] || "").trim(),
        createdAt,
        updatedAt,
        createdBy: req.user.id,
      };
    });

    const batchSize = 500;
    let insertedCount = 0;
    const errors = [];

    for (let i = 0; i < validatedEntries.length; i += batchSize) {
      const batch = validatedEntries.slice(i, i + batchSize);
      try {
        const result = await Entry.insertMany(batch, { ordered: false });
        insertedCount += result.length;
      } catch (batchError) {
        if (batchError.name === "BulkWriteError" || batchError.code === 11000) {
          insertedCount += batchError.insertedDocs ? batchError.insertedDocs.length : 0;
          if (batchError.writeErrors) {
            batchError.writeErrors.forEach((err) => {
              errors.push(
                `Upload problem in batch ${Math.floor(i / batchSize) + 1}: ${err.errmsg || "Some entries could not be saved."}`
              );
            });
          }
        } else {
          console.error("Batch error:", batchError.message);
          errors.push(
            `Upload problem in batch ${Math.floor(i / batchSize) + 1}: ${batchError.message}`
          );
        }
      }
    }

    // IMPORTANT: Clear ALL cache after bulk upload so data shows for everyone
    clearAllCache();

    if (insertedCount === 0 && errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "No entries were uploaded due to errors.",
        errors,
      });
    } else if (errors.length > 0) {
      return res.status(207).json({
        success: true,
        message: `Some entries were uploaded successfully (${insertedCount}), but there were issues with others.`,
        insertedCount,
        errors,
      });
    }

    res.status(201).json({
      success: true,
      message: `All ${insertedCount} entries were uploaded successfully!`,
      insertedCount,
    });
  } catch (error) {
    console.error("Error in bulk upload:", error.message);
    res.status(400).json({
      success: false,
      message:
        "We couldn't upload your data due to a problem. Please check the file and try again. If the issue continues, contact support.",
      error: error.message,
    });
  }
};

// getAdmin - Check if user is admin
const getAdmin = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message:
          "You are not logged in or your session has expired. Please log in again to continue.",
      });
    }

    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "We couldn't find your user information. Please try logging in again or contact support if the issue persists.",
      });
    }

    res.status(200).json({
      success: true,
      isAdmin: user.role === "Admin" || user.role === "Superadmin",
      isSuperadmin: user.role === "Superadmin",
    });
  } catch (error) {
    console.error("Error fetching user:", error.message);
    res.status(500).json({
      success: false,
      message:
        "Something went wrong on our side while fetching your details. Please try again later. If the problem continues, contact support.",
      error: error.message,
    });
  }
};

const sendEntryEmail = async (req, res) => {
  try {
    const { entryId } = req.body;

    // Validate entryId
    if (!mongoose.Types.ObjectId.isValid(entryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid entry ID provided.",
      });
    }

    // Fetch the entry
    const entry = await Entry.findById(entryId).populate(
      "createdBy",
      "username"
    );
    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "Entry not found.",
      });
    }

    // Check if email exists
    if (!entry.email || !entry.email.trim()) {
      return res.status(400).json({
        success: false,
        message: "No valid email address associated with this entry.",
      });
    }

    // Authorization check
    const normalizedRole =
      req.user.role.charAt(0).toUpperCase() +
      req.user.role.slice(1).toLowerCase();
    if (
      normalizedRole !== "Admin" &&
      normalizedRole !== "Superadmin" &&
      entry.createdBy._id.toString() !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to send an email for this entry.",
      });
    } 
    const subject = `Your Journey with Promark Techsolutions Begins!`;
    const text = `Thank you for connecting with Promark – a 22-year-old company with a legacy in EdTech, AV, and Furniture, owning its own factories, serving government, private, and autonomous organisations in India.
  Proudly part of the "Make in India" initiative.`;
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Journey with Promark Techsolutions</title>
        <style>
          body { font-family: 'Poppins', Arial, sans-serif; background-color: #f4f6f9; margin: 0; padding: 0; }
          .container { max-width: 850px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 20px rgba(0,0,0,0.15); }
          .content { padding: 0px; text-align: center; }
          .content img { max-width: 100%; height: auto; display: block; margin: 0 auto; border-radius: 20px; }
          .content .middle-image { max-width: 800px; min-height: 400px; margin: 50px auto; padding: 20px; border: 2px solid #e0e0e0; background-color: #f9f9f9; box-shadow: 0 8px 20px rgba(0,0,0,0.15); vertical-align: middle; }
          @media (max-width: 600px) {
            .container { margin: 10px; width: 100%; }
            .content { padding: 20px 10px; }
            .content img { max-width: 100%; margin: 0 auto; }
            .content .middle-image { max-width: 100%; min-height: 50vh; margin: 20px 0; padding: 10px; width: 100%; box-sizing: border-box; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="content">
            <img src="cid:middle-image" alt="Promark Middle Image" class="middle-image">
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email using Nodemailer with attachments
    await sendMail(entry.email, subject, text, html, [
      {
        filename: 'middle.png',
        path: 'public/middle.png',
        cid: 'middle-image'
      },
    ]);

    res.status(200).json({
      success: true,
      message: `Email sent successfully to ${entry.email}.`,
    });
  } catch (error) {
    console.error("Error sending email:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to send email. Please try again later.",
      error: error.message,
    });
  }
};

module.exports = {
  sendEntryEmail,
  bulkUploadStocks,
  DataentryLogic,
  fetchEntries,
  DeleteData,
  editEntry,
  exportentry,
  getAdmin,
  getUsers,
};
