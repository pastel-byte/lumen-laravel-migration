export function convertVersion(version: string): string {
    const match = version.match(/\^(\d+)\.(\d+)/);
    if (match) {
        return `${match[1]}.*`;
    }
    return version;
}

export function parseEnvContent(envContent: string): Record<string, string> {
    const envVars: Record<string, string> = {};

    envContent.split('\n').forEach((line) => {
        const [key, value] = line.split('=');
        if (key && value !== undefined) {
            envVars[key.trim()] = value.trim();
        }
    });

    return envVars;
}

