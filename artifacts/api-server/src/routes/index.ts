import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scraperRouter from "./scraper";
import recorderRouter from "./recorder";
import downloadRouter from "./download";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scraperRouter);
router.use(recorderRouter);
router.use(downloadRouter);

export default router;
