require("dotenv").config({ path: __dirname + "/.env" });
const express = require("express");
const dbconnect = require("./utils/db.connect");
const cors = require("cors");
const LoginRoute = require("./Router/LoginRoute");
const SignupRoute = require("./Router/SignupRoute");
const DataRoute = require("./Router/DataRouter");
const SmartfloDialerRouter = require("./Router/SmartfloDialerRouter");
const SmartfloAdminRouter = require("./Router/SmartfloAdminRouter");
const SmartfloWebhookRouter = require("./Router/SmartfloWebhookRouter");
const SmartfloAnalyticsRouter = require("./Router/SmartfloAnalyticsRouter");
const app = express();
const port = 3000;

// CORS options
const corsOptions = {
  origin: [
    "https://dms-jade.vercel.app",
    "https://dms-git-staging-akshay124-pixels-projects.vercel.app",
  ],
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
};


app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// API Routes Middleware
app.use("/auth", LoginRoute);
app.use("/user", SignupRoute);
app.use("/api", DataRoute);

// Smartflo Integration Routes
app.use("/api/dialer", SmartfloDialerRouter);
app.use("/api/smartflo", SmartfloAdminRouter);
app.use("/api/webhooks/smartflo", SmartfloWebhookRouter);
app.use("/api/analytics", SmartfloAnalyticsRouter);

dbconnect()
  .then(() => {
    app.listen(port, () => {
      console.log(`App listening on port ${port}!`);
    });
  })
  .catch((error) => {
    console.error("Database connection failed", error);
    process.exit(1);
  });
