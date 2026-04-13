import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scraperRouter from "./scraper";
import recorderRouter from "./recorder";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scraperRouter);
router.use(recorderRouter);

export default router;
