import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
  targets: port(z.string().optional().describe('IP addresses, subnets, or hostnames'), {
    label: 'Targets',
    description:
      'IP addresses, subnets, or hostnames to scan. One per line or comma-separated.',
    editor: 'textarea',
  }),
  domains: port(z.string().optional().describe('Domain names'), {
    label: 'Domains',
    description: 'Domain names for enumeration or scanning. One per line or comma-separated.',
    editor: 'textarea',
  }),
  urls: port(z.string().optional().describe('URLs to process'), {
    label: 'URLs',
    description: 'Full URLs to process. One per line or comma-separated.',
    editor: 'textarea',
  }),
  command: port(z.string().optional().describe('Shell command to execute'), {
    label: 'Command',
    description: 'Shell command to pass to a Command Executor or similar component.',
    editor: 'code',
  }),
  customText: port(z.string().optional().describe('Custom text input'), {
    label: 'Custom Text',
    description: 'Any custom text data to pass to downstream components.',
    editor: 'textarea',
  }),
  credentials: port(z.string().optional().describe('Password or secret value'), {
    label: 'Credentials',
    description: 'Sensitive credentials like passwords or tokens.',
    editor: 'secret',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
  apiKey: port(z.string().optional().describe('API key'), {
    label: 'API Key',
    description: 'API key for external services.',
    editor: 'secret',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
  jsonData: port(z.string().optional().describe('JSON data'), {
    label: 'JSON Data',
    description: 'Raw JSON data to pass to downstream components.',
    editor: 'code',
  }),
});

const outputSchema = outputs({
  targets: port(z.string(), {
    label: 'Targets',
    description: 'IP addresses, subnets, or hostnames.',
  }),
  targetsList: port(z.array(z.string()), {
    label: 'Targets List',
    description: 'Targets split into an array (by newline or comma).',
  }),
  domains: port(z.string(), {
    label: 'Domains',
    description: 'Domain names.',
  }),
  domainsList: port(z.array(z.string()), {
    label: 'Domains List',
    description: 'Domains split into an array (by newline or comma).',
  }),
  urls: port(z.string(), {
    label: 'URLs',
    description: 'URLs to process.',
  }),
  urlsList: port(z.array(z.string()), {
    label: 'URLs List',
    description: 'URLs split into an array (by newline or comma).',
  }),
  command: port(z.string(), {
    label: 'Command',
    description: 'Shell command.',
  }),
  customText: port(z.string(), {
    label: 'Custom Text',
    description: 'Custom text data.',
  }),
  credentials: port(z.string(), {
    label: 'Credentials',
    description: 'Credentials value.',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
  apiKey: port(z.string(), {
    label: 'API Key',
    description: 'API key value.',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
  jsonData: port(z.string(), {
    label: 'JSON Data',
    description: 'Raw JSON string.',
  }),
  parsedJson: port(z.any().optional(), {
    label: 'Parsed JSON',
    description: 'Parsed JSON object (if valid JSON was provided).',
    allowAny: true,
    reason: 'JSON can be any valid structure.',
  }),
});

const parameterSchema = parameters({});

/**
 * Splits a string by newlines or commas into a trimmed array.
 */
function splitToList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const definition = defineComponent({
  id: 'core.workflow.entrypoint.simple',
  label: 'Simple Entry Point',
  category: 'input',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'A simplified entry point with predefined input fields for common workflow data like targets, domains, commands, and credentials. Just enter values directly without JSON formatting.',
  ui: {
    slug: 'entry-point-simple',
    version: '1.0.0',
    type: 'trigger',
    category: 'input',
    description:
      'Simplified workflow entry point with predefined fields for targets, domains, commands, and secrets.',
    icon: 'Play',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Enter IP addresses or subnets to pass to security scanners.',
      'Provide domain names for subdomain enumeration tools.',
      'Pass shell commands to Command Executor components.',
    ],
  },
  async execute({ inputs }, context) {
    context.logger.info('[Simple Entry Point] Processing inputs...');

    // Parse lists from text inputs
    const targetsList = splitToList(inputs.targets);
    const domainsList = splitToList(inputs.domains);
    const urlsList = splitToList(inputs.urls);

    // Attempt to parse JSON data
    let parsedJson: unknown = undefined;
    if (inputs.jsonData) {
      try {
        parsedJson = JSON.parse(inputs.jsonData);
        context.logger.info('[Simple Entry Point] Successfully parsed JSON data.');
      } catch {
        context.logger.warn('[Simple Entry Point] JSON data is not valid JSON, skipping parse.');
      }
    }

    // Log non-sensitive inputs
    context.logger.info(`[Simple Entry Point] Targets: ${targetsList.length} items`);
    context.logger.info(`[Simple Entry Point] Domains: ${domainsList.length} items`);
    context.logger.info(`[Simple Entry Point] URLs: ${urlsList.length} items`);
    if (inputs.command) {
      context.logger.info(`[Simple Entry Point] Command provided: ${inputs.command.slice(0, 50)}...`);
    }

    const outputCount = [
      inputs.targets,
      inputs.domains,
      inputs.urls,
      inputs.command,
      inputs.customText,
      inputs.credentials,
      inputs.apiKey,
      inputs.jsonData,
    ].filter(Boolean).length;

    context.emitProgress(`Processed ${outputCount} input fields`);

    return {
      targets: inputs.targets ?? '',
      targetsList,
      domains: inputs.domains ?? '',
      domainsList,
      urls: inputs.urls ?? '',
      urlsList,
      command: inputs.command ?? '',
      customText: inputs.customText ?? '',
      credentials: inputs.credentials ?? '',
      apiKey: inputs.apiKey ?? '',
      jsonData: inputs.jsonData ?? '',
      parsedJson,
    };
  },
});

componentRegistry.register(definition);

type SimpleEntryPointInput = typeof inputSchema;
type SimpleEntryPointOutput = typeof outputSchema;

export type { SimpleEntryPointInput, SimpleEntryPointOutput };
