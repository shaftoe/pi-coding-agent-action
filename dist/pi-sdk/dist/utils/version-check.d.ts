export declare function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined;
export declare function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean;
export declare function getLatestPiVersion(currentVersion: string, options?: {
    timeoutMs?: number;
}): Promise<string | undefined>;
export declare function checkForNewPiVersion(currentVersion: string): Promise<string | undefined>;
//# sourceMappingURL=version-check.d.ts.map