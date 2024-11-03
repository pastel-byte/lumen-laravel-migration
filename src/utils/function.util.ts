import fs from 'fs-extra';
import path from 'path';
import shell from 'shelljs';

export async function copyDirectoryWithProgress(source: string, destination: string, excludeFile?: string): Promise<void> {
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

export function execShellCommand(cmd: string, options?: { cwd?: string, noInteration?: string }): Promise<void> {
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