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

async function createLaravelProject(): Promise<void> {
    console.log("Create laravel project...");
    const newFolderPath = path.join(projectInfo.destination);
    console.log(`composer create-project --prefer-dist laravel/laravel ${newFolderPath} "${projectInfo.version}"`);
    await execShellCommand(`composer create-project --prefer-dist laravel/laravel "${newFolderPath}" "${projectInfo.version}"`);
}

async function copyLumenFiles(): Promise<void> {
    return new Promise(async (resolve, reject) => {
        console.log("Copying Lumen Files to Laravel Project...");

        // Daftar folder yang akan disalin
        const foldersToCopy = ['config', 'public'];

        try {
            for (const folder of foldersToCopy) {
                const sourcePath = path.join(projectInfo.origin, folder);
                const destinationPath = path.join(projectInfo.destination, folder);

                // Pastikan direktori tujuan ada
                await fs.ensureDir(destinationPath);

                // Salin file dengan pengecualian khusus untuk 'index.php' di folder 'public'
                if (folder === 'public') {
                    await copyDirectoryWithProgress(sourcePath, destinationPath, 'index.php');
                } else {
                    await copyDirectoryWithProgress(sourcePath, destinationPath);
                }
            }

            console.log("All files copied successfully!");
            resolve();
        } catch (error) {
            console.error("Error copying files:", error);
            reject(error);
        }
    });
}

// Fungsi untuk menyalin direktori dengan progres

async function copyDirectoryWithProgress(source: string, destination: string, excludeFile?: string): Promise<void> {
    const items = await fs.readdir(source, { withFileTypes: true });

    for (const item of items) {
        const sourcePath = path.join(source, item.name);
        const destinationPath = path.join(destination, item.name);

        // Skip excluded file
        if (excludeFile && item.name === excludeFile) {
            console.log(`Skipping ${item.name}`);
            continue;
        }

        if (item.isDirectory()) {
            await fs.ensureDir(destinationPath);
            await copyDirectoryWithProgress(sourcePath, destinationPath, excludeFile); // Recursively copy subdirectories
        } else {
            await fs.copy(sourcePath, destinationPath);
            console.log(`Copied file: ${destinationPath}`);
        }
    }
}

async function adjustComposerJson(): Promise<void> {
    console.log("Adjusting composer.json...");
    const lumenComposerFile = path.join(projectInfo.origin, 'composer.json');
    const laravelComposerFile = path.join(projectInfo.destination, 'composer.json');

    try {
        // Membaca dan mengurai file composer.json Lumen
        const lumenComposer = await fs.readJson(lumenComposerFile);
        // Membaca dan mengurai file composer.json Laravel
        const laravelComposer = await fs.readJson(laravelComposerFile);

        // Menghapus dependensi Lumen dari composer.json Lumen
        delete lumenComposer.require['laravel/lumen-framework'];

        // Menggabungkan dependensi Lumen ke Laravel
        Object.entries(lumenComposer.require).forEach(([key, value]) => {
            if (!laravelComposer.require[key]) {
                laravelComposer.require[key] = value; // Tambahkan ke Laravel jika belum ada
            }
        });

        // Menggabungkan bagian autoload
        laravelComposer.autoload = {
            ...laravelComposer.autoload,
            ...lumenComposer.autoload
        };

        // Menulis kembali composer.json Laravel dengan dependensi yang telah disesuaikan
        await fs.writeJson(laravelComposerFile, laravelComposer, { spaces: 2 });

        console.log("composer.json has been adjusted successfully!");
    } catch (error) {
        console.error("Error adjusting composer.json:", error);
        throw error; // Menyampaikan error ke pemanggil
    }
}

// Step 3: Adjust Config Files
function adjustConfig(): void {
    console.log("Adjusting Laravel Configuration...");
    const envPath = path.resolve("laravel_project/.env");

    // Tambahkan konfigurasi DB sesuai kebutuhan
    fs.appendFileSync(envPath, "\nDB_CONNECTION=mysql\nDB_HOST=127.0.0.1\nDB_PORT=3306\nDB_DATABASE=lumen_database\nDB_USERNAME=root\nDB_PASSWORD=");
}

// Step 4: Install Dependencies
async function installDependencies(): Promise<void> {
    const lockFilePath = path.join(projectInfo.destination, 'composer.lock');
    const errorLogFilePath = path.join(projectInfo.destination, 'removed_packages.txt');

    try {
        // Hapus composer.lock jika ada
        if (fs.existsSync(lockFilePath)) {
            console.log("Removing existing composer.lock...");
            fs.unlinkSync(lockFilePath);
        }

        // Jalankan composer install
        console.log("Installing dependencies...");
        await execShellCommand(`composer install`, { cwd: projectInfo.destination });
        console.log("Dependencies installed successfully!");

    } catch (error) {
        console.error("Error installing dependencies:", error);

        // Ambil nama paket yang menyebabkan masalah dari error message
        const errorMessage = (error as Error).message;
        const packagesToRemove: string[] = [];

        // RegEx untuk menemukan nama paket dari pesan kesalahan
        const packageRegex = /([a-zA-Z0-9\/\.\-_]+)\[\d+\.\d+\.\d+.*?\] require.*?-> your php version \(\d+\.\d+\.\d+\) does not satisfy that requirement/;
        const lines = errorMessage.split('\n');
        for (const line of lines) {
            const match = line.match(packageRegex);
            if (match && match[1]) {
                packagesToRemove.push(match[1]);
            }
        }

        // Hapus paket dari composer.json dan catat di file
        const composerFilePath = path.join(projectInfo.destination, 'composer.json');
        const composerJson = await fs.readJSON(composerFilePath);

        // Catat paket yang dihapus ke dalam file
        if (packagesToRemove.length > 0) {
            console.log("Removing incompatible packages:", packagesToRemove);
            await fs.appendFile(errorLogFilePath, `Incompatible packages:\n${packagesToRemove.join('\n')}\n\n`);

            packagesToRemove.forEach(packageName => {
                // Hapus dari require
                delete composerJson.require[packageName];
                // Hapus dari require-dev jika ada
                delete composerJson['require-dev'][packageName];
            });

            // Simpan composer.json yang telah diperbarui
            await fs.writeJSON(composerFilePath, composerJson, { spaces: 2 });

            // Jalankan composer install kembali
            console.log("Retrying composer install after removing incompatible packages...");
            await execShellCommand(`composer install --no-scripts`, { cwd: projectInfo.destination });
            console.log("Dependencies installed successfully after cleanup!");
        }
    }
}

async function adjustConsoleKernelFile(): Promise<void> {
    const kernelFilePath = path.join(projectInfo.destination, 'app', 'Console', 'Kernel.php');

    try {
        // Membaca isi file Kernel.php
        let fileContent = await fs.readFile(kernelFilePath, 'utf8');

        // Mengganti namespace dari Lumen ke Laravel
        fileContent = fileContent.replace(
            /use Laravel\\Lumen\\Console\\Kernel as ConsoleKernel;/,
            'use Illuminate\\Foundation\\Console\\Kernel as ConsoleKernel;'
        );

        // Menyimpan kembali file yang telah diperbarui
        await fs.writeFile(kernelFilePath, fileContent, 'utf8');
        console.log('Successfully updated Kernel.php namespace.');
    } catch (error) {
        console.error('Error updating Kernel.php:', error);
    }
}

async function adjustExceptionHandlerFile(): Promise<void> {
    const kernelFilePath = path.join(projectInfo.destination, 'app', 'Exceptions', 'Handler.php');

    try {
        // Membaca isi file Kernel.php
        let fileContent = await fs.readFile(kernelFilePath, 'utf8');

        // Mengganti namespace dari Lumen ke Laravel
        fileContent = fileContent.replace(
            /use Laravel\\Lumen\\Exceptions\\Handler as ExceptionHandler;/,
            'use Illuminate\\Foundation\\Exceptions\\Handler as ExceptionHandler;'
        );

        // Menyimpan kembali file yang telah diperbarui
        await fs.writeFile(kernelFilePath, fileContent, 'utf8');
        console.log('Successfully updated Handler.php namespace.');
    } catch (error) {
        console.error('Error updating Kernel.php:', error);
    }
}

async function adjustProviderFile(): Promise<void> {
    const eventSPFilePath = path.join(projectInfo.destination, 'app', 'Providers', 'EventServiceProvider.php');

    try {
        // Membaca isi file Kernel.php
        let fileContent = await fs.readFile(eventSPFilePath, 'utf8');

        // Mengganti namespace dari Lumen ke Laravel
        fileContent = fileContent.replace(
            /use Laravel\\Lumen\\Providers\\EventServiceProvider as ServiceProvider;/,
            'use Illuminate\\Foundation\\Support\\Providers\\EventServiceProvider as ServiceProvider;'
        );

        // Menyimpan kembali file yang telah diperbarui
        await fs.writeFile(eventSPFilePath, fileContent, 'utf8');
        console.log('Successfully updated All Provider namespace.');
    } catch (error) {
        console.error('Error updating ', error);
    }
}

async function adjustControllerFile(): Promise<void> {
    const eventSPFilePath = path.join(projectInfo.destination, 'app', 'Http', 'Controllers', 'Controller.php');

    try {
        // Membaca isi file Kernel.php
        let fileContent = await fs.readFile(eventSPFilePath, 'utf8');

        // Mengganti namespace dari Lumen ke Laravel
        fileContent = fileContent.replace(
            /use Laravel\\Lumen\\Routing\\Controller as BaseController;/,
            'use Illuminate\\Routing\\Controller as BaseController;'
        );

        // Menyimpan kembali file yang telah diperbarui
        await fs.writeFile(eventSPFilePath, fileContent, 'utf8');
        console.log('Successfully updated Controller.php.');
    } catch (error) {
        console.error('Error updating ', error);
    }
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

async function convertRoutesLumenToLaravel(): Promise<void> {
    try {
        // Baca isi file routes Lumen
        const routeFilePath = path.join(projectInfo.destination, 'routes', 'web.php');
        const data = await fs.promises.readFile(routeFilePath, 'utf-8');

        // Buat konversi dengan regex:
        // 1. Ubah komentar tentang variable router di Lumen
        // 2. Ubah setiap $router-> ke Route::
        let convertedData = data
            .replace(/\/*\* @var \\Laravel\\Lumen\\Routing\\Router \$router \*\//g, '')
            .replace(/\$router->/g, 'Route::')
            .replace(/use \(\$router\)/g, ''); // Hapus use ($router)

        // Tambahkan namespace di awal file jika tidak ada
        if (!convertedData.includes('use Illuminate\\Support\\Facades\\Route;')) {
            convertedData = convertedData.replace(
                /^<\?php/g,
                `<?php\n\nuse Illuminate\\Support\\Facades\\Route;`
            );
        }

        // Cari dan sesuaikan setiap controller dengan namespace App\Http\Controllers
        convertedData = convertedData.replace(/Route::(get|post|put|delete|patch|options|any)\(([^,]+),\s*'([^@]+)@([^']+)'\)/g,
            (match, method, route, controller, action) => {
                // Bentuk lengkap dengan namespace dan format array untuk Laravel
                const namespacedController = `App\\Http\\Controllers\\${controller}`;
                return `Route::${method}(${route.trim()}, [${namespacedController}::class, '${action}'])`;
            }
        );

        // Simpan ke file tujuan di Laravel
        await fs.promises.writeFile(routeFilePath, convertedData);
        console.log("Routes have been successfully converted from Lumen to Laravel format!");
    } catch (error) {
        console.error("Error converting routes:", error);
    }
}

async function moveRouteToApi() {
    try {
        const webRouteFilePath = path.join(projectInfo.destination, 'routes', 'web.php');
        const apiRouteFilePath = path.join(projectInfo.destination, 'routes', 'api.php');

        // Hapus file api.php jika ada
        if (fs.existsSync(apiRouteFilePath)) {
            await fs.promises.unlink(apiRouteFilePath);
            console.log("Existing api.php file has been removed.");
        }

        // Ganti nama web.php menjadi api.php
        await fs.promises.rename(webRouteFilePath, apiRouteFilePath);
        console.log("web.php has been renamed to api.php.");

        // Buat file web.php baru dengan isi yang ditentukan
        const newWebData = `<?php\n\nuse Illuminate\\Support\\Facades\\Route;\n\n/*\n|--------------------------------------------------------------------------\n| Web Routes\n|--------------------------------------------------------------------------\n|\n| Here is where you can register web routes for your application.\n| These routes are loaded by the RouteServiceProvider within a group which\n| contains the "web" middleware group. Now create something great!\n|\n*/\n\nRoute::get('/', function () {\n    return view('welcome');\n});\n`;

        await fs.promises.writeFile(webRouteFilePath, newWebData);
        console.log("New web.php file has been created with default content.");
    } catch (error) {
        console.error("Error during renaming and creating files:", error);
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
