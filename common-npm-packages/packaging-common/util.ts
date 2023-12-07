import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

import * as tl from 'azure-pipelines-task-lib/task';
import { getSystemAccessToken } from './locationUtilities';

interface EndpointCredentials {
    endpoint: string;
    username?: string;
    password: string;
}

export enum PackageToolType {
    NuGetCommand,
    DotNetCoreCLI,
    UniversalPackages,
    Npm
}

export function getTempPath(): string {
    const tempNpmrcDir
        = tl.getVariable('Agent.BuildDirectory')
        || tl.getVariable('Agent.TempDirectory');
        const tempPath = path.join(tempNpmrcDir, 'npm');
    if (tl.exist(tempPath) === false) {
        tl.mkdirP(tempPath);
    }

    return tempPath;
}

function copyFile(src: string, dst: string): void {
    const content = fs.readFileSync(src);
    fs.writeFileSync(dst, content);
}

export function saveFile(file: string): void {
    if (file && tl.exist(file)) {
        const tempPath = getTempPath();
        const baseName = path.basename(file);
        const destination = path.join(tempPath, baseName);

        tl.debug(tl.loc('SavingFile', file));
        copyFile(file, destination);
    }
}

export function saveFileWithName(file: string, name: string, filePath: string): void {
    if (file && tl.exist(file)) {
        const destination = path.join(filePath, name + '.npmrc');
        tl.debug(tl.loc('SavingFile', file));
        copyFile(file, destination);
    }
}

export function restoreFile(file: string): void {
    if (file) {
        const tempPath = getTempPath();
        const baseName = path.basename(file);
        const source = path.join(tempPath, baseName);

        if (tl.exist(source)) {
            tl.debug(tl.loc('RestoringFile', file));
            copyFile(source, file);
            tl.rmRF(source);
        }
    }
}

export function restoreFileWithName(file: string, name: string, filePath: string): void {
    if (file) {
        const source = path.join(filePath, name + '.npmrc');
        if (tl.exist(source)) {
            tl.debug(tl.loc('RestoringFile', file));
            copyFile(source, file);
            tl.rmRF(source);
        }
    }
}

export function toNerfDart(uri: string): string {
    var parsed = url.parse(uri);
    delete parsed.protocol;
    delete parsed.auth;
    delete parsed.query;
    delete parsed.search;
    delete parsed.hash;

    return url.resolve(url.format(parsed), '.');
}

export function getProjectAndFeedIdFromInputParam(inputParam: string): any {
    const feedProject = tl.getInput(inputParam);
    return getProjectAndFeedIdFromInput(feedProject);
}

export function getProjectAndFeedIdFromInput(feedProject: string): any {
    let projectId = null;
    let feedId = feedProject;
    if(feedProject && feedProject.includes("/")) {
        const feedProjectParts = feedProject.split("/");
        projectId = feedProjectParts[0] || null;
        feedId = feedProjectParts[1];
    }

    return {
        feedId: feedId,
        projectId: projectId
    }
}

export enum LogType {
    debug,
    warning,
    error
}

export function getAccessToken(nugetFeedType:string, endpointInputKey:string, feedInputKey:string, packageToolType: PackageToolType) : string {
    let accessToken: string = getSystemAccessToken();
    if (nugetFeedType.toLowerCase() == "internal") {
        let feed = getProjectAndFeedIdFromInputParam(feedInputKey);
        accessToken = getUserAccessToken(tl.getInput(endpointInputKey), packageToolType, feed);
    }

    if (!accessToken) {
        tl.debug(`Access token not set. Using System Access token.`);
        return getSystemAccessToken();
    }
    return accessToken;
}

function getUserAccessToken(endpointName: string, packageToolType: PackageToolType, feed: any): string {
    let token = "";
    tl.debug("Checking if the token is already set.");

    if(endpointName) {
        tl.debug(`Checking if the endpoint ${endpointName} provided by user, can be used.`);
        token = getAccessTokenFromServiceConnectionForInternalFeeds(endpointName);
    }
    else {
        tl.debug("Checking if the credentials are set in the environment.");
        token = getAccessTokenFromEnvironmentForInternalFeeds(feed, packageToolType);
    }

    return token;
}

function getAccessTokenFromServiceConnectionForInternalFeeds(endpointName: string): string {
    let token: string = "";
    let auth = tl.getEndpointAuthorization(endpointName, true);
    let scheme = tl.getEndpointAuthorizationScheme(endpointName, true).toLowerCase();
    switch(scheme)
    {
        case ("token"):
            token = auth.parameters["apitoken"];
            break;
        default:
            tl.warning("Invalid authentication type for internal feed. Use token based authentication.");
            break;
    }

    return token;
}

function getAccessTokenFromEnvironmentForInternalFeeds(feed: any, packageToolType: PackageToolType) : string {
    let token: string = "";

    switch(packageToolType)
    {
        case PackageToolType.NuGetCommand:
        case PackageToolType.DotNetCoreCLI:
            const JsonEndpointsString = process.env["VSS_NUGET_EXTERNAL_FEED_ENDPOINTS"];
            if (JsonEndpointsString) {
                tl.debug(`Endpoints found: ${JsonEndpointsString}`);

                let endpointsArray: { endpointCredentials: EndpointCredentials[] } = JSON.parse(JsonEndpointsString);
                tl.debug(`Feed details ${feed.feedId} ${feed.projectId}`);

                for (let endpoint_in = 0; endpoint_in < endpointsArray.endpointCredentials.length; endpoint_in++) {
                    if (endpointsArray.endpointCredentials[endpoint_in].endpoint.search(feed.feedId) != -1) {
                        tl.debug(`Endpoint Credentials found for ${feed.feedId}`);
                        token = endpointsArray.endpointCredentials[endpoint_in].password;
                        break;
                    }
                }
            }
            break;
        case PackageToolType.UniversalPackages:
            token = process.env["UNIVERSAL_PUBLISH_PAT"];
            break;
        default:
            tl.warning("PackageToolType not supported");
    }

    return token;
}

function log(message: string, logType: LogType) {
    if (logType === LogType.warning) {
        tl.warning(message);
    } else if (logType === LogType.error) {
        tl.error(message);
    } else {
        tl.debug(message);
    }
}

/**
 * Logs the error instead of throwing.
 */
export function logError(error: any, logType: LogType = LogType.debug) {
    if (error instanceof Error) {
        if (error.message) { log(error.message, logType); }
        if (error.stack) { log(error.stack, LogType.debug); } // Log stack always as debug
    } else {
        log(`Error: ${error}`, logType);
    }
}
