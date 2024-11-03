import express, { Request, Response, NextFunction, Application } from 'express';
import shell from 'shelljs';
import fs from 'fs-extra';
import path from 'path';
import { ProjectInfo } from './interface';
import { exec } from 'child_process';
import progress from 'progress-stream';
import apiRoutes from './routes/api.route';

const app: Application = express();
const storagePath = path.resolve("storage");
const repoPath = path.join(storagePath, "repositories");
let noInteraction = "false";
let withEnv = "false";
const PORT = 5000;

const projectInfo: ProjectInfo = {
    name: "",
    version: "",
    origin: "",
    destination: "",
};

function execShellCommand(cmd: string, options?: { cwd?: string }): Promise<void> {
    return new Promise((resolve, reject) => {
        const execOptions = {
            cwd: options?.cwd || process.cwd(), // Gunakan cwd saat ini jika tidak ada yang diberikan
        };

        const modifiedCmd = `${cmd} --no-interaction`;

        shell.exec(modifiedCmd, execOptions, (code, stdout, stderr) => {
            console.log(`Command: ${cmd}`);
            console.log(`stdout: ${stdout}`);
            console.log(`stderr: ${stderr}`);
            if (code !== 0) {
                reject(new Error(stderr));
            } else {
                resolve();
            }
        });
    });
}

function convertVersion(version: string): string {
    const match = version.match(/\^(\d+)\.(\d+)/);
    if (match) {
        return `${match[1]}.*`;
    }
    return version;
}

// Helper function untuk mem-parsing isi .env menjadi objek key-value
function parseEnvContent(envContent: string): Record<string, string> {
    const envVars: Record<string, string> = {};

    envContent.split('\n').forEach((line) => {
        const [key, value] = line.split('=');
        if (key && value !== undefined) {
            envVars[key.trim()] = value.trim();
        }
    });

    return envVars;
}

async function getLumenComposer() {
    const composerFile = path.join(projectInfo.origin, 'composer.json');
    const file = await fs.readFileSync(composerFile, 'utf8');
    const composerJson = JSON.parse(file);
    const lumenVersion = composerJson.require['laravel/lumen-framework'];
    // RESULT IS ^9.0 AND WE NEED 9.*
    projectInfo.version = convertVersion(lumenVersion);
}




async function mergeEnvFiles(): Promise<void> {
    const lumenEnvPath = path.join(projectInfo.origin, '.env'); // Path ke .env di proyek Lumen
    const laravelEnvPath = path.join(projectInfo.destination, '.env'); // Path ke .env di proyek Laravel

    try {
        // Baca isi file .env Lumen dan Laravel
        const lumenEnvContent = await fs.readFile(lumenEnvPath, 'utf8');
        const laravelEnvContent = await fs.readFile(laravelEnvPath, 'utf8');

        // Parse isi .env menjadi objek key-value
        const lumenEnvVars = parseEnvContent(lumenEnvContent);
        const laravelEnvVars = parseEnvContent(laravelEnvContent);

        // Menggabungkan variabel-variabel dari Lumen ke Laravel, menjaga variabel Laravel jika ada yang duplikat
        const mergedEnvVars = { ...lumenEnvVars, ...laravelEnvVars };

        // Konversi objek hasil penggabungan kembali ke format .env string
        const mergedEnvContent = Object.entries(mergedEnvVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        // Tulis hasil penggabungan ke file .env Laravel
        await fs.writeFile(laravelEnvPath, mergedEnvContent, 'utf8');
        console.log('Successfully merged .env files.');
    } catch (error) {
        console.error('Error merging .env files:', error);
    }
}



// app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.use('/api', apiRoutes);

// Endpoint untuk migrasi Lumen ke Laravel
app.post('/migrate', async (req: Request, res: Response): Promise<any> => {
    const projectPath = req.query.projectPath as string;  // Path Lumen dari query parameter
    const projectName = req.query.projectName as string;  // Path Lumen dari query parameter
    noInteraction = req.query.noInteraction as string;  // Path Lumen dari query parameter
    withEnv = req.query.withEnv as string;  // Path Lumen dari query parameter
    if (!projectPath) {
        return res.status(400).send("Please provide the Lumen project path.");
    }
    if (!projectName) {
        return res.status(400).send("Please provide the project name.");
    }

    projectInfo.name = projectName;
    projectInfo.origin = path.join(repoPath, projectName, projectPath);
    projectInfo.destination = path.join(repoPath, projectName, projectPath + "_new");
    res.json({ success: true, message: "Lumen to Laravel Migration On Progress...", data: null });

    try {
        // Memanggil fungsi tanpa menunggu hasilnya
        (async () => {
            // await getLumenComposer();
            // await createLaravelProject();
            // await copyLumenFiles();
            // await adjustComposerJson();
            // await adjustConsoleKernelFile();
            // await adjustExceptionHandlerFile();
            // await adjustProviderFile();
            // await adjustControllerFile();
            // await convertRoutesLumenToLaravel();
            // await moveRouteToApi();
            // await installDependencies();

            if (withEnv === "true") {
                await mergeEnvFiles();
            }
            console.log("Lumen to Laravel Migration Completed!");
        })();
    } catch (error) {
        console.error("Migration failed:", error);
    }
});

app.listen(PORT, () => {
    console.log(`Bot server is running on http://localhost:${PORT}`);
});
