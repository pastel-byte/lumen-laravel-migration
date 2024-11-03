import { migrateProject } from "../services/migration.service";
import { ProjectInfo } from "../interface";
import { Request, Response } from 'express';

export async function migrate(req: Request, res: Response) {
    const projectPath = req.body.projectPath as string;  // Path Lumen dari query parameter
    const projectName = req.body.projectName as string;  // Path Lumen dari query parameter
    const noInteraction = req.body.noInteraction as string;  // Path Lumen dari query parameter
    const withEnv = req.body.withEnv as string;  // Path Lumen dari query parameter
    
    try {
        (async () => {
            await migrateProject(projectPath, projectName, noInteraction, withEnv);
            console.log("Lumen to Laravel Migration Completed!");
        })();
       
        return true
    } catch (error) {
        throw error;
    }
}