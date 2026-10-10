import { Router } from "express";
import { createDeployment } from "../controllers/deployment.controller.js";
import multer from "multer";

const router = Router();

const upload = multer({
  dest: path.join(os.tmpdir(), "uploads"),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/\.zip$/i.test(file.originalname)) cb(null, true);
    else cb(new Error("Only .zip files allowed"));
  },
});

const router = Router();
router.post("/", upload.single("project"), createDeployment);

export default router;