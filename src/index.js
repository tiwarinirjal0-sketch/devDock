import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
import { connectDB } from "./config/db.js";
import authRoute from "./routes/auth.route.js";
import deploymentRoute from "./routes/deployment.route.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

app.use("/api/auth", authRoute);
app.use("/api/deployments", deploymentRoute); // add requireAuth here later

// Must come after the routes. Turns multer errors into JSON.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code });
  }
  if (err.message === "Only .zip files allowed") {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  // await connectDB();
  console.log(`Server running on port ${PORT}`);
});