/**
 * Data Controller
 * Handles CRUD operations, bulk upload, export with caching
 */
const mongoose = require("mongoose");
const Entry = require("../Schema/DataModel");
const User = require("../Schema/Model");
const XLSX = require("xlsx");
const { sendMail } = require("../utils/mailer");
const { smartInvalidate } = require("../Middleware/CacheMiddleware");
const { parse, format, isValid } = require("date-fns");

/**
 * Sanitize phone number - extract last 10 digits
 * @param {string|number} phone - Phone number to sanitize
 * @returns {string} - Sanitized 10-digit phone number or empty string
 */
const sanitizePhone = (phone) => {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, ""); // Remove all non-digits
  if (digits.length === 0) return "";
  if (digits.length >= 10) return digits.slice(-10); // Take last 10 digits
  return ""; // Invalid if less than 10 digits
};

/**
 * DataentryLogic - Create a single entry
 */
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

    const newEntry = new Entry({
      customerName: customerName ? customerName.trim() : "",
      mobileNumber: sanitizePhone(mobileNumber),
      contactName: contactName ? contactName.trim() : "",
      AlterNumber: sanitizePhone(AlterNumber),
      email: email ? email.trim().toLowerCase() : "",
      address: address ? address.trim() : "",
      product: product ? product.trim() : "",
      state: state ? state.trim() : "",
      city: city ? city.trim() : "",
      organization: organization ? organization.trim() : "",
      category: category ? category.trim() : "",
      createdBy: req.user.id,
      status: status || "Not Found",
      remarks: remarks ? remarks.trim() : "",
      estimatedValue: estimatedValue ? parseFloat(estimatedValue) || null : null,
      history: status && remarks ? [{
        status,
        remarks: remarks.trim(),
        timestamp: new Date(),
      }] : [],
    });

    await newEntry.save();

    // Populate createdBy to match fetch response structure
    // This ensures the response has the same shape as fetchEntries
    await newEntry.populate('createdBy', 'username _id');

    // REAL-TIME: No cache to invalidate - data is always fresh
    if (process.env.NODE_ENV === 'development') {
      console.log("🔄 REAL-TIME: Entry created - no cache invalidation needed");
    }

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
      message: "Oops! Something went wrong on our side. Please try again later.",
      error: error.message,
    });
  }
};

/**
 * Build filter object from query parameters
 */
const buildFilter = (req, normalizedRole) => {
  const filter = {};
  const {
    searchTerm,
    selectedOrganization,
    selectedStateA,
    selectedCityA,
    selectedCreatedBy,
    startDate,
    endDate,
    status,
    dashboardFilter,
  } = req.query;

  // DEBUG: Log the parameters being received
  // Build filter for data queries - only log in development
  if (process.env.NODE_ENV === 'development') {
    console.log("🔍 buildFilter:", {
      startDate,
      endDate,
      dashboardFilter,
      searchTerm,
      selectedOrganization,
      selectedStateA,
      selectedCityA,
      selectedCreatedBy
    });
  }

  // Role-based filtering
  if (normalizedRole !== "Admin" && normalizedRole !== "Superadmin") {
    filter.createdBy = mongoose.Types.ObjectId.createFromHexString(req.user.id);
  }

  // Search filter (customer name, address, mobile number)
  if (searchTerm) {
    filter.$or = [
      { customerName: { $regex: searchTerm, $options: "i" } },
      { address: { $regex: searchTerm, $options: "i" } },
      { mobileNumber: { $regex: searchTerm, $options: "i" } },
    ];
  }

  // Organization filter
  if (selectedOrganization) {
    filter.organization = selectedOrganization;
  }

  // State filter
  if (selectedStateA) {
    filter.state = selectedStateA;
  }

  // City filter
  if (selectedCityA) {
    filter.city = selectedCityA;
  }

  // Created by filter
  if (selectedCreatedBy) {
    // Need to lookup user by username
    // This will be handled in the query with populate
  }

  // Date range filter - CRITICAL FIX: Only filter by createdAt to prevent previous month entries
  if (startDate || endDate) {
    if (process.env.NODE_ENV === 'development') {
      console.log("🔍 Date filter - Raw dates:", { startDate, endDate });
    }

    if (startDate && endDate) {
      // TIMEZONE FIX: Parse dates as local dates, not UTC
      const start = new Date(startDate + 'T00:00:00');
      const end = new Date(endDate + 'T23:59:59.999');

      if (process.env.NODE_ENV === 'development') {
        console.log("🔍 Date filter - Converted dates:", {
          start: start.toISOString(),
          end: end.toISOString(),
          startLocal: start.toLocaleString(),
          endLocal: end.toLocaleString()
        });
      }

      // CRITICAL: Use ONLY createdAt for date filtering to prevent unwanted entries
      filter.createdAt = { $gte: start, $lte: end };

      // IMPORTANT: Clear any existing $or conditions that might conflict with date range
      // This prevents monthly filters from overriding the specific date range
      if (filter.$or) {
        if (process.env.NODE_ENV === 'development') {
          console.log("🚨 WARNING: Clearing $or filter to prevent date range conflicts");
        }
        delete filter.$or;
      }

    } else if (startDate) {
      const start = new Date(startDate + 'T00:00:00');
      if (process.env.NODE_ENV === 'development') {
        console.log("🔍 Date filter - Start only:", { start: start.toISOString() });
      }
      filter.createdAt = { $gte: start };
    } else if (endDate) {
      const end = new Date(endDate + 'T23:59:59.999');
      if (process.env.NODE_ENV === 'development') {
        console.log("🔍 Date filter - End only:", { end: end.toISOString() });
      }
      filter.createdAt = { $lte: end };
    }
  }

  // Status filter
  if (status) {
    filter.status = status;
  }

  // Dashboard filter (leads, results, monthly, etc.)
  if (dashboardFilter === "leads") {
    filter.status = "Not Found";
  } else if (dashboardFilter === "monthly") {
    // CRITICAL FIX: Only apply monthly filter if no specific date range is provided
    // When user selects specific dates, NEVER apply monthly filter to prevent date conflicts
    if (!startDate && !endDate) {
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      filter.$or = [
        {
          $expr: {
            $and: [
              { $eq: [{ $month: "$createdAt" }, currentMonth + 1] },
              { $eq: [{ $year: "$createdAt" }, currentYear] },
            ],
          },
        },
        {
          $expr: {
            $and: [
              { $eq: [{ $month: "$updatedAt" }, currentMonth + 1] },
              { $eq: [{ $year: "$updatedAt" }, currentYear] },
            ],
          },
        },
      ];
    }
    // IMPORTANT: If date range is provided, monthly filter is completely ignored
    // This prevents the $or condition from overriding the specific date range filter
  } else if (dashboardFilter === "Closed Won") {
    filter.closetype = "Closed Won";
  } else if (dashboardFilter === "Closed Lost") {
    filter.closetype = "Closed Lost";
  } else if (dashboardFilter && dashboardFilter !== "total" && dashboardFilter !== "results") {
    filter.status = dashboardFilter;
  }

  // DEBUG: Log the final filter (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log("🔍 Final filter:", JSON.stringify(filter, null, 2));
  }

  return filter;
};

/**
 * fetchEntries - Fetch entries with pagination and filters
 */
const fetchEntries = async (req, res) => {
  try {
    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    // Fetch entries request logged without sensitive user data
    if (process.env.NODE_ENV === 'development') {
      console.log("📊 fetchEntries: Role:", normalizedRole);
    }

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({
        success: false,
        errorCode: "INVALID_USER_ID",
        message: "The user ID provided in your session is invalid. Please log out and log back in.",
      });
    }

    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // REAL-TIME: No caching for entries to ensure filters and pagination work correctly
    if (process.env.NODE_ENV === 'development') {
      console.log("📊 REAL-TIME: Fetching entries directly from DB (no cache)");
    }

    // Build filter from query parameters
    let filter = buildFilter(req, normalizedRole);

    // Handle createdBy filter (username lookup)
    let createdByUserId = null;
    if (req.query.selectedCreatedBy && (normalizedRole === "Admin" || normalizedRole === "Superadmin")) {
      const User = require("../Schema/Model");
      const user = await User.findOne({ username: req.query.selectedCreatedBy }).lean();
      if (user) {
        createdByUserId = user._id;
        filter.createdBy = createdByUserId;
      }
    }

    // Sort options
    const sortOptions = { createdAt: -1 };

    // Execute query with pagination
    const [entries, total] = await Promise.all([
      Entry.find(filter)
        .populate("createdBy", "username _id")
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),
      Entry.countDocuments(filter),
    ]);

    // Normalize entries (convert ObjectIds to strings)
    const normalizedEntries = entries.map((entry) => ({
      ...entry,
      _id: entry._id.toString(),
      createdBy: {
        _id: entry.createdBy?._id?.toString() || null,
        username: entry.createdBy?.username || "Unknown",
      },
    }));

    if (process.env.NODE_ENV === 'development') {
      console.log("📊 REAL-TIME: Fetched entries:", normalizedEntries.length, "of", total);
    }

    const result = {
      success: true,
      data: normalizedEntries,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasMore: skip + entries.length < total,
      },
    };

    // NO CACHING - Real-time data for perfect filter and pagination behavior
    if (process.env.NODE_ENV === 'development') {
      console.log("📊 REAL-TIME: Returning fresh data (no caching)");
    }

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching entries:", error.message);
    res.status(500).json({
      success: false,
      errorCode: "SERVER_ERROR",
      message: "We couldn't retrieve your entries at the moment. Please try again later.",
      error: error.message,
    });
  }
};

/**
 * editEntry - Update an entry
 */
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

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "The entry ID provided is not valid. Please check and try again.",
      });
    }

    const entry = await Entry.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "We could not find the entry you are trying to update. It might have been deleted.",
      });
    }

    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    if (normalizedRole !== "Admin" && normalizedRole !== "Superadmin" && entry.createdBy.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to update this entry.",
      });
    }

    const updateData = {
      ...(customerName !== undefined && { customerName: customerName.trim() || entry.customerName }),
      ...(contactName !== undefined && { contactName: contactName.trim() || entry.contactName }),
      ...(mobileNumber !== undefined && { mobileNumber: sanitizePhone(mobileNumber) || entry.mobileNumber }),
      ...(AlterNumber !== undefined && { AlterNumber: sanitizePhone(AlterNumber) || entry.AlterNumber }),
      ...(email !== undefined && { email: email.trim().toLowerCase() || entry.email }),
      ...(address !== undefined && { address: address.trim() || entry.address }),
      ...(state !== undefined && { state: state.trim() || "" }),
      ...(city !== undefined && { city: city.trim() || "" }),
      ...(product !== undefined && { product: product.trim() || entry.product }),
      ...(organization !== undefined && { organization: organization.trim() || entry.organization }),
      ...(category !== undefined && { category: category.trim() || entry.category }),
      ...(status !== undefined && { status }),
      ...(remarks !== undefined && { remarks: remarks ? remarks.trim() : "" }),
      ...(estimatedValue !== undefined && { estimatedValue: parseFloat(estimatedValue) || null }),
      updatedAt: new Date(),
    };

    // Track update in history
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
      if (!closetype || !["Closed Won", "Closed Lost"].includes(closetype.trim())) {
        return res.status(400).json({
          success: false,
          message: "When closing an entry, please specify if it is 'Closed Won' or 'Closed Lost'.",
        });
      }
      updateData.closetype = closetype.trim();
      updateData.closeamount = parseFloat(closeamount) || null;
    } else {
      updateData.closetype = "";
      updateData.closeamount = null;
    }

    const updatedEntry = await Entry.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate('createdBy', 'username _id').lean();

    // REAL-TIME: No cache to invalidate - data is always fresh
    if (process.env.NODE_ENV === 'development') {
      console.log("🔄 REAL-TIME: Entry updated - no cache invalidation needed");
    }

    res.status(200).json({
      success: true,
      data: updatedEntry,
      message: "Entry updated successfully.",
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Some fields contain invalid data.",
        errors: messages,
      });
    }
    console.error("Error in editEntry:", error.message);
    res.status(500).json({
      success: false,
      message: "We encountered an error while updating your entry.",
      error: error.message,
    });
  }
};

/**
 * DeleteData - Delete an entry
 */
const DeleteData = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "The entry ID you provided is not valid.",
      });
    }

    const entry = await Entry.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "We could not find the entry you are trying to delete.",
      });
    }

    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    if (normalizedRole !== "Admin" && normalizedRole !== "Superadmin") {
      if (!entry.createdBy || entry.createdBy.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to delete this entry.",
        });
      }
    }

    await Entry.findByIdAndDelete(req.params.id);

    // REAL-TIME: No cache to invalidate - data is always fresh
    if (process.env.NODE_ENV === 'development') {
      console.log("🔄 REAL-TIME: Entry deleted - no cache invalidation needed");
    }

    res.status(200).json({
      success: true,
      message: "Entry has been deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting entry:", error.message);
    res.status(500).json({
      success: false,
      message: "We ran into an issue while trying to delete the entry.",
      error: error.message,
    });
  }
};

/**
 * bulkUploadStocks - Bulk upload entries with phone sanitization
 */
const bulkUploadStocks = async (req, res) => {
  try {
    const newEntries = req.body;

    if (!Array.isArray(newEntries) || newEntries.length === 0) {
      return res.status(400).json({
        success: false,
        message: "The uploaded data is not in the correct format. Please upload a list of entries.",
      });
    }

    // Map and sanitize entries
    const validatedEntries = newEntries.map((entry) => ({
      customerName: entry["Customer Name"] ? String(entry["Customer Name"]).trim() : "",
      contactName: entry["Contact Person"] ? String(entry["Contact Person"]).trim() : "",
      email: entry["Email"] ? String(entry["Email"]).trim().toLowerCase() : "",
      mobileNumber: sanitizePhone(entry["Contact Number"]),
      AlterNumber: sanitizePhone(entry["Alternate Number"]),
      product: entry["Product"] ? String(entry["Product"]).trim() : "",
      address: entry["Address"] ? String(entry["Address"]).trim() : "",
      organization: entry["Organization"] ? String(entry["Organization"]).trim() : "",
      category: entry["Category"] ? String(entry["Category"]).trim() : "",
      city: entry["District"] ? String(entry["District"]).trim() : "",
      state: entry["State"] ? String(entry["State"]).trim() : "",
      status: (entry["Status"] || entry["status"]) ? String(entry["Status"] || entry["status"]).trim() : "Not Found",
      remarks: (entry["Remarks"] || entry["remarks"]) ? String(entry["Remarks"] || entry["remarks"]).trim() : "",
      createdAt: (() => {
        const val = entry["Created At"];
        if (val) {
          if (val instanceof Date) return val;
          // Try custom format first (slashes)
          let parsed = parse(String(val), "dd/MM/yyyy", new Date());
          if (isValid(parsed)) return parsed;
          // Try custom format (hyphens) - STRICT DD-MM-YYYY
          parsed = parse(String(val), "dd-MM-yyyy", new Date());
          if (isValid(parsed)) return parsed;
          // Try standard parsing
          const standard = new Date(val);
          if (!isNaN(standard.getTime())) return standard;
        }
        return entry.createdAt ? new Date(entry.createdAt) : new Date();
      })(),
      updatedAt: (() => {
        const val = entry["Updated At"];
        if (val) {
          if (val instanceof Date) return val;
          // Try custom format (slashes)
          let parsed = parse(String(val), "dd/MM/yyyy", new Date());
          if (isValid(parsed)) return parsed;
          // Try custom format (hyphens) - STRICT DD-MM-YYYY
          parsed = parse(String(val), "dd-MM-yyyy", new Date());
          if (isValid(parsed)) return parsed;
          // Try standard parsing
          const standard = new Date(val);
          if (!isNaN(standard.getTime())) return standard;
        }
        return entry.updatedAt ? new Date(entry.updatedAt) : new Date();
      })(),
      createdBy: req.user.id,
    }));

    // Process in batches of 500
    const batchSize = 500;
    let insertedCount = 0;
    const errors = [];

    for (let i = 0; i < validatedEntries.length; i += batchSize) {
      const batch = validatedEntries.slice(i, i + batchSize);
      try {
        // ordered: false allows partial success
        const result = await Entry.insertMany(batch, { ordered: false });
        insertedCount += result.length;
      } catch (batchError) {
        if (batchError.name === "BulkWriteError" || batchError.code === 11000) {
          // Handle partial success
          insertedCount += batchError.insertedDocs ? batchError.insertedDocs.length : 0;
          if (batchError.writeErrors) {
            batchError.writeErrors.forEach((err) => {
              errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${err.errmsg || "Validation error"}`);
            });
          }
        } else {
          errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${batchError.message}`);
        }
      }
    }

    // REAL-TIME: No cache to invalidate - data is always fresh
    if (insertedCount > 0 && process.env.NODE_ENV === 'development') {
      console.log("🔄 REAL-TIME: Bulk upload completed - no cache invalidation needed");
    }

    // Return appropriate status
    if (insertedCount === 0 && errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "No entries were uploaded due to errors.",
        insertedCount: 0,
        errors,
      });
    } else if (errors.length > 0) {
      return res.status(207).json({
        success: true,
        message: `Partially uploaded ${insertedCount} entries with some errors.`,
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
      message: "We couldn't upload your data due to a problem.",
      error: error.message,
    });
  }
};

/**
 * exportentry - Export entries to XLSX (role-based filtering)
 */
const exportentry = async (req, res) => {
  try {
    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();

    let entries;
    if (normalizedRole === "Admin" || normalizedRole === "Superadmin") {
      entries = await Entry.find().populate("createdBy", "username").lean();
    } else {
      entries = await Entry.find({ createdBy: req.user.id }).populate("createdBy", "username").lean();
    }

    // Format entries for export
    const formattedEntries = entries.map((entry) => ({
      "Customer Name": entry.customerName || "",
      "Contact Person": entry.contactName || "",
      "Email": entry.email || "",
      "Contact Number": entry.mobileNumber || "",
      "Alternate Number": entry.AlterNumber || "",
      "Product": entry.product || "",
      "Address": entry.address || "",
      "Organization": entry.organization || "",
      "Category": entry.category || "",
      "District": entry.city || "",
      "State": entry.state || "",
      "Status": entry.status || "Not Found",
      "Remarks": entry.remarks || "", // Align default with Frontend
      "Created By": entry.createdBy?.username || "",
      "Created At": entry.createdAt ? new Date(entry.createdAt) : "",
    }));

    // Create XLSX workbook with STRICT date format DD-MM-YYYY
    const ws = XLSX.utils.json_to_sheet(formattedEntries, { dateNF: "dd-mm-yyyy" });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customer Entries");

    const fileBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Set response headers
    res.setHeader("Content-Disposition", "attachment; filename=entries.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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

/**
 * getUsers - Get users based on role
 */
const getUsers = async (req, res) => {
  try {
    const normalizeRole = (role) => role ? role.charAt(0).toUpperCase() + role.slice(1).toLowerCase() : "Others";
    const userRole = normalizeRole(req.user.role);

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
      users = await User.find({ _id: req.user.id }).select("_id username role").lean();
    }

    if (!users.length) {
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

    res.status(200).json({
      success: true,
      data: normalizedUsers,
    });
  } catch (error) {
    console.error("getUsers Error:", error.message);
    res.status(500).json({
      success: false,
      errorCode: "SERVER_ERROR",
      message: "We couldn't retrieve the user list right now.",
      error: error.message,
    });
  }
};

/**
 * fetchAllEntries - Fetch ALL entries with filters (for analytics, not paginated)
 * This is used for analytics drawers that need full dataset
 */
const fetchAllEntries = async (req, res) => {
  try {
    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    // Fetch all entries request logged without sensitive user data
    if (process.env.NODE_ENV === 'development') {
      console.log("fetchAllEntries: Role:", normalizedRole);
    }

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({
        success: false,
        errorCode: "INVALID_USER_ID",
        message: "The user ID provided in your session is invalid.",
      });
    }

    // Build filter from query parameters (same as fetchEntries but no pagination)
    let filter = buildFilter(req, normalizedRole);

    // Handle createdBy filter (username lookup)
    if (req.query.selectedCreatedBy && (normalizedRole === "Admin" || normalizedRole === "Superadmin")) {
      const User = require("../Schema/Model");
      const user = await User.findOne({ username: req.query.selectedCreatedBy }).lean();
      if (user) {
        filter.createdBy = user._id;
      }
    }

    // Sort options
    const sortOptions = { createdAt: -1 };

    // Fetch ALL entries (no pagination)
    const entries = await Entry.find(filter)
      .populate("createdBy", "username _id")
      .sort(sortOptions)
      .lean();

    // Normalize entries (convert ObjectIds to strings)
    const normalizedEntries = entries.map((entry) => ({
      ...entry,
      _id: entry._id.toString(),
      createdBy: {
        _id: entry.createdBy?._id?.toString() || null,
        username: entry.createdBy?.username || "Unknown",
      },
    }));

    console.log("Fetched all entries count:", normalizedEntries.length);

    res.status(200).json({
      success: true,
      data: normalizedEntries,
      total: normalizedEntries.length,
    });
  } catch (error) {
    console.error("Error fetching all entries:", error.message);
    res.status(500).json({
      success: false,
      errorCode: "SERVER_ERROR",
      message: "We couldn't retrieve entries at the moment. Please try again later.",
      error: error.message,
    });
  }
};

/**
 * getEntryCounts - Get counts for trackers (optimized count-only queries)
 * This endpoint returns only counts, not full data, for performance
 */
const getEntryCounts = async (req, res) => {
  try {
    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      return res.status(400).json({
        success: false,
        errorCode: "INVALID_USER_ID",
        message: "The user ID provided in your session is invalid.",
      });
    }

    // REAL-TIME: No caching for entry counts to ensure dashboard statistics are always accurate
    if (process.env.NODE_ENV === 'development') {
      console.log("📊 REAL-TIME: Calculating entry counts directly from DB (no cache)");
    }

    // Build base filter (same as fetchEntries but without pagination)
    let filter = buildFilter(req, normalizedRole);

    // Handle createdBy filter
    if (req.query.selectedCreatedBy && (normalizedRole === "Admin" || normalizedRole === "Superadmin")) {
      const User = require("../Schema/Model");
      const user = await User.findOne({ username: req.query.selectedCreatedBy }).lean();
      if (user) {
        filter.createdBy = user._id;
      }
    }

    // Get total count (all filtered entries)
    const totalResults = await Entry.countDocuments(filter);

    // Get leads count (status = "Not Found")
    const leadsFilter = { ...filter, status: "Not Found" };
    const totalLeads = await Entry.countDocuments(leadsFilter);

    // Get monthly calls count using optimized aggregation (NO document fetch)
    // Monthly calls = entries created this month + history entries for entries created/updated this month
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Create monthly filter combining base filter with monthly date conditions
    // Monthly filter should apply base filters AND monthly date condition
    const monthlyDateCondition = {
      $or: [
        {
          $expr: {
            $and: [
              { $eq: [{ $month: "$createdAt" }, currentMonth + 1] },
              { $eq: [{ $year: "$createdAt" }, currentYear] },
            ],
          },
        },
        {
          $expr: {
            $and: [
              { $eq: [{ $month: "$updatedAt" }, currentMonth + 1] },
              { $eq: [{ $year: "$updatedAt" }, currentYear] },
            ],
          },
        },
      ],
    };

    // Combine base filter with monthly date condition using $and
    // This ensures base filters (search, organization, etc.) are applied AND monthly condition
    const monthlyFilter = filter.$or || filter.$and
      ? { $and: [filter, monthlyDateCondition] }
      : { ...filter, ...monthlyDateCondition };

    // Use aggregation to count monthly calls WITHOUT fetching documents
    // This is optimized to only return counts, not full documents
    const monthlyCallsResult = await Entry.aggregate([
      { $match: monthlyFilter },
      {
        $project: {
          isCreatedThisMonth: {
            $and: [
              { $eq: [{ $month: "$createdAt" }, currentMonth + 1] },
              { $eq: [{ $year: "$createdAt" }, currentYear] },
            ],
          },
          isUpdatedThisMonth: {
            $and: [
              { $eq: [{ $month: "$updatedAt" }, currentMonth + 1] },
              { $eq: [{ $year: "$updatedAt" }, currentYear] },
            ],
          },
          historyCount: { $size: { $ifNull: ["$history", []] } },
        },
      },
      {
        $project: {
          callCount: {
            $add: [
              { $cond: ["$isCreatedThisMonth", 1, 0] }, // Count entry if created this month
              {
                $cond: [
                  { $or: ["$isCreatedThisMonth", "$isUpdatedThisMonth"] },
                  "$historyCount",
                  0,
                ],
              }, // Count history if created/updated this month
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          totalMonthlyCalls: { $sum: "$callCount" },
        },
      },
    ]);

    const monthlyCalls = monthlyCallsResult[0]?.totalMonthlyCalls || 0;

    // Get status-based counts
    const statusCounts = await Entry.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const statusMap = {};
    statusCounts.forEach((item) => {
      statusMap[item._id] = item.count;
    });

    // Get close type counts
    const closeTypeCounts = await Entry.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$closetype",
          count: { $sum: 1 },
        },
      },
    ]);

    const closeTypeMap = {};
    closeTypeCounts.forEach((item) => {
      if (item._id) closeTypeMap[item._id] = item.count;
    });

    const result = {
      success: true,
      data: {
        totalLeads,
        totalResults,
        monthlyCalls,
        statusCounts: statusMap,
        closeTypeCounts: closeTypeMap,
      },
    };

    // NO CACHING - Real-time data for accurate dashboard statistics
    if (process.env.NODE_ENV === 'development') {
      console.log("📊 REAL-TIME: Returning fresh entry counts (no caching)");
    }

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching entry counts:", error.message);
    res.status(500).json({
      success: false,
      errorCode: "SERVER_ERROR",
      message: "We couldn't retrieve entry counts at the moment. Please try again later.",
      error: error.message,
    });
  }
};

/**
 * getAdmin - Check if user is admin
 */
const getAdmin = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "You are not logged in or your session has expired.",
      });
    }

    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "We couldn't find your user information.",
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
      message: "Something went wrong while fetching your details.",
      error: error.message,
    });
  }
};

/**
 * sendEntryEmail - Send email for an entry
 */
const sendEntryEmail = async (req, res) => {
  try {
    const { entryId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(entryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid entry ID provided.",
      });
    }

    const entry = await Entry.findById(entryId).populate("createdBy", "username");
    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "Entry not found.",
      });
    }

    if (!entry.email || !entry.email.trim()) {
      return res.status(400).json({
        success: false,
        message: "No valid email address associated with this entry.",
      });
    }

    const normalizedRole = req.user.role.charAt(0).toUpperCase() + req.user.role.slice(1).toLowerCase();
    if (normalizedRole !== "Admin" && normalizedRole !== "Superadmin" && entry.createdBy._id.toString() !== req.user.id) {
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
          .content .middle-image { max-width: 800px; min-height: 400px; margin: 50px auto; padding: 0px; border: 2px solid #e0e0e0; background-color: #f9f9f9; box-shadow: 0 8px 20px rgba(0,0,0,0.15); vertical-align: middle; }
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


// Send Quotation Email
const sendQuotationEmail = async (req, res) => {
  try {
    const {
      entryId,
      productType,
      specification,
      quantity,
      price,
      customerEmail,
      customerName,
    } = req.body;

    // Validate required fields
    if (
      !entryId ||
      !productType ||
      !specification ||
      !quantity ||
      !price ||
      !customerEmail
    ) {
      return res.status(400).json({
        success: false,
        message:
          "All fields are required (entryId, productType, specification, quantity, price, customerEmail).",
      });
    }

    // Validate entryId
    if (!mongoose.Types.ObjectId.isValid(entryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid entry ID provided.",
      });
    }

    // Validate quantity and price
    if (quantity <= 0 || price <= 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity and price must be greater than 0.",
      });
    }

    // Fetch the entry for authorization check
    // Performance Optimization: Select only required fields and optimize populate
    const entry = await Entry.findById(entryId)
      .select("createdBy") // Only fetch createdBy field for authorization check
      .populate({
        path: "createdBy",
        select: "username _id", // Only fetch username and _id from User collection
        options: { lean: true } // Convert Mongoose document to plain JS object for better performance
      });
    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "Entry not found.",
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
        message:
          "You do not have permission to send a quotation for this entry.",
      });
    }

    // Calculate total amount
    const totalAmount = quantity * price;
    const formattedPrice = price.toLocaleString("en-IN");
    const formattedTotal = totalAmount.toLocaleString("en-IN");

    // Email subject and content
    const subject = `Quotation from Promark Techsolutions - ${productType}`;
    const text = `Dear ${customerName},

Thank you for your interest in Promark Techsolutions.

Please find below the quotation details:

Product Type: ${productType}
Specification: ${specification}
Quantity: ${quantity}
Unit Price: ₹${formattedPrice}
Total Amount: ₹${formattedTotal}

We look forward to serving you.

Best Regards,
Promark Techsolutions Pvt Ltd
A 22-year-old company with legacy in EdTech, AV, and Furniture
Proudly part of "Make in India" initiative`;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Quotation from Promark Techsolutions</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; margin: 0; padding: 0; }
          .container { max-width: 700px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%); padding: 30px; text-align: center; color: white; }
          .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
          .header p { margin: 10px 0 0; font-size: 14px; opacity: 0.9; }
          .content { padding: 40px 30px; }
          .greeting { font-size: 18px; color: #333; margin-bottom: 20px; }
          .quotation-box { background: #f8f9fa; border-left: 4px solid #6a11cb; padding: 20px; margin: 20px 0; border-radius: 8px; }
          .quotation-box h2 { margin: 0 0 15px; color: #6a11cb; font-size: 20px; }
          .quotation-item { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
          .quotation-item:last-child { border-bottom: none; }
          .quotation-item .label { font-weight: 600; color: #555; }
          .quotation-item .value { color: #333; font-weight: 500; }
          .total-row { background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%); color: white; padding: 15px 20px; margin-top: 15px; border-radius: 8px; display: flex; justify-content: space-between; font-size: 18px; font-weight: 700; }
          .footer { background: #f8f9fa; padding: 25px 30px; text-align: center; color: #666; font-size: 14px; line-height: 1.6; }
          .footer strong { color: #333; }
          @media (max-width: 600px) {
            .container { margin: 10px; width: calc(100% - 20px); }
            .content { padding: 20px 15px; }
            .header h1 { font-size: 22px; }
            .quotation-item { flex-direction: column; gap: 5px; }
            .total-row { flex-direction: column; gap: 5px; text-align: center; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💼 QUOTATION</h1>
            <p>Promark Techsolutions Pvt Ltd</p>
          </div>
          
          <div class="content">
            <p class="greeting">Dear <strong>${customerName}</strong>,</p>
            <p>Thank you for your interest in <strong>Promark Techsolutions</strong>. We are pleased to provide you with the following quotation:</p>
            
            <div class="quotation-box">
              <h2>📋 Quotation Details</h2>
              <div class="quotation-item">
                <span class="label">Product Type:</span>
                <span class="value">${productType}</span>
              </div>
              <div class="quotation-item">
                <span class="label">Specification:</span>
                <span class="value">${specification}</span>
              </div>
              <div class="quotation-item">
                <span class="label">Quantity:</span>
                <span class="value">${quantity}</span>
              </div>
              <div class="quotation-item">
                <span class="label">Unit Price:</span>
                <span class="value">₹${formattedPrice}</span>
              </div>
              <div class="total-row">
                <span>Total Amount:</span>
                <span>₹${formattedTotal}</span>
              </div>
            </div>
            
            <p style="margin-top: 25px; color: #555; line-height: 1.6;">
              We look forward to the opportunity to serve you and provide you with the best quality products and services.
            </p>
            <p style="color: #555; line-height: 1.6;">
              Should you have any questions or require further information, please do not hesitate to contact us.
            </p>
          </div>
          
          <div class="footer">
            <p><strong>Promark Techsolutions Pvt Ltd</strong></p>
            <p>A 22-year-old company with a legacy in EdTech, AV, and Furniture</p>
            <p>Owning its own factories, serving government, private, and autonomous organisations in India</p>
            <p>Proudly part of the <strong>"Make in India"</strong> initiative</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email
    await sendMail(customerEmail, subject, text, html);

    res.status(200).json({
      success: true,
      message: `Quotation email sent successfully to ${customerEmail}.`,
    });
  } catch (error) {
    console.error("Error sending quotation email:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to send quotation email. Please try again later.",
      error: error.message,
    });
  }
};


module.exports = {
  sendEntryEmail,
  bulkUploadStocks,
  sendQuotationEmail,
  DataentryLogic,
  fetchEntries,
  fetchAllEntries,
  getEntryCounts,
  DeleteData,
  editEntry,
  exportentry,
  getAdmin,
  getUsers,
};
