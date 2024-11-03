import express, { Request, Response, NextFunction, Application } from 'express';
import { migrate } from "../controllers/migration.controller";

const router = express.Router();

router.post("/migrate", (req, res) => {
    

    const data = migrate(req, res);
    res.status(200).send({ success: true, message: "Lumen to Laravel Migration On Progress...", data: data });
});

export default router;