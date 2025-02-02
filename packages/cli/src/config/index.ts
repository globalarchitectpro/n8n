import { GlobalConfig } from '@n8n/config';
import { Container } from '@n8n/di';
import convict from 'convict';
import { flatten } from 'flat';
import { readFileSync } from 'fs';
import merge from 'lodash/merge';
import { Logger } from 'n8n-core';
import { ApplicationError, setGlobalState } from 'n8n-workflow';
import assert from 'node:assert';
import colors from 'picocolors';

import { inTest, inE2ETests } from '@/constants';

if (inE2ETests) {
	// Skip loading config from env variables in end-to-end tests
	process.env.N8N_DIAGNOSTICS_ENABLED = 'false';
	process.env.N8N_PUBLIC_API_DISABLED = 'true';
	process.env.EXTERNAL_FRONTEND_HOOKS_URLS = '';
	process.env.N8N_PERSONALIZATION_ENABLED = 'false';
	process.env.N8N_AI_ENABLED = 'true';
} else if (inTest) {
	process.env.N8N_LOG_LEVEL = 'silent';
	process.env.N8N_PUBLIC_API_DISABLED = 'true';
	process.env.SKIP_STATISTICS_EVENTS = 'true';
	process.env.N8N_SECURE_COOKIE = 'false';
	process.env.N8N_SKIP_AUTH_ON_OAUTH_CALLBACK = 'true';
}

// Load schema after process.env has been overwritten
import { schema } from './schema';
const config = convict(schema, { args: [] });

// eslint-disable-next-line @typescript-eslint/unbound-method
config.getEnv = config.get;

const logger = Container.get(Logger);
const globalConfig = Container.get(GlobalConfig);

// Load overwrites when not in tests
if (!inE2ETests && !inTest) {
	// Overwrite default configuration with settings which got defined in
	// optional configuration files
	const { N8N_CONFIG_FILES } = process.env;
	if (N8N_CONFIG_FILES !== undefined) {
		const configFiles = N8N_CONFIG_FILES.split(',');
		for (const configFile of configFiles) {
			if (!configFile) continue;
			// NOTE: This is "temporary" code until we have migrated all config to the new package
			try {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				const data = JSON.parse(readFileSync(configFile, 'utf8'));
				for (const prefix in data) {
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
					const innerData = data[prefix];
					if (prefix in globalConfig) {
						// @ts-ignore
						merge(globalConfig[prefix], innerData);
					} else {
						const flattenedData: Record<string, string> = flatten(innerData);
						for (const key in flattenedData) {
							config.set(`${prefix}.${key}`, flattenedData[key]);
						}
					}
				}
				logger.debug(`Loaded config overwrites from ${configFile}`);
			} catch (error) {
				assert(error instanceof Error);
				logger.error(`Error loading config file ${configFile}`, { error });
			}
		}
	}

	// Overwrite config from files defined in "_FILE" environment variables
	Object.entries(process.env).forEach(([envName, fileName]) => {
		if (envName.endsWith('_FILE') && fileName) {
			const configEnvName = envName.replace(/_FILE$/, '');
			// @ts-ignore
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
			const key = config._env[configEnvName]?.[0] as string;
			if (key) {
				let value: string;
				try {
					value = readFileSync(fileName, 'utf8');
				} catch (error) {
					// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
					if (error.code === 'ENOENT') {
						throw new ApplicationError('File not found', { extra: { fileName } });
					}
					throw error;
				}
				config.set(key, value);
			}
		}
	});
}

// Validate Configuration
config.validate({
	allowed: 'strict',
});
const userManagement = config.get('userManagement');
if (userManagement.jwtRefreshTimeoutHours >= userManagement.jwtSessionDurationHours) {
	if (!inTest)
		logger.warn(
			'N8N_USER_MANAGEMENT_JWT_REFRESH_TIMEOUT_HOURS needs to smaller than N8N_USER_MANAGEMENT_JWT_DURATION_HOURS. Setting N8N_USER_MANAGEMENT_JWT_REFRESH_TIMEOUT_HOURS to 0 for now.',
		);

	config.set('userManagement.jwtRefreshTimeoutHours', 0);
}

const executionProcess = config.getEnv('executions.process');
if (executionProcess) {
	logger.error(
		colors.yellow('Please unset the deprecated env variable') +
			colors.bold(colors.yellow('EXECUTIONS_PROCESS')),
	);
}
if (executionProcess === 'own') {
	logger.error(
		colors.bold(colors.red('Application failed to start because "Own" mode has been removed.')),
	);
	logger.error(
		colors.red(
			'If you need the isolation and performance gains, please consider using queue mode instead.\n\n',
		),
	);
	process.exit(-1);
}

setGlobalState({
	defaultTimezone: globalConfig.generic.timezone,
});

// eslint-disable-next-line import/no-default-export
export default config;

export type Config = typeof config;
