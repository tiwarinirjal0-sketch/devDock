import { Router } from 'express';
import { register, login, resumeData, Ai } from '../controllers/auth.controller.js';
import { upload, verifyUser } from '../middleware/auth.middleware.js';
import { getJobs } from '../controllers/auth.controller.js';
// import { resumeData } from '../controllers/auth.controller.js';
const router = Router();

router.post('/register', register);
router.post('/login', verifyUser, login);
router.get("/jobs", getJobs)
router.post("/upload", verifyUser, resumeData)
router.post("/ai",upload.single("file"), Ai)


export default router;
