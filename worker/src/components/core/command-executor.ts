import { z } from 'zod';
import {
  componentRegistry,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ContainerError,
  ComponentRetryPolicy,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const inputSchema = inputs({
  command: port(z.string().min(1).describe('Shell command to execute'), {
    label: 'Command',
    description: 'Shell command to execute inside the container.',
    editor: 'code',
  }),
  workingDirectory: port(z.string().optional().describe('Working directory inside container'), {
    label: 'Working Directory',
    description: 'Working directory path inside the container (defaults to /workspace).',
  }),
  environmentVariables: port(
    z.record(z.string(), z.string()).optional().describe('Environment variables to inject'),
    {
      label: 'Environment Variables',
      description: 'Key-value pairs of environment variables to set in the container.',
    },
  ),
  stdinInput: port(z.string().optional().describe('Text to pipe via stdin'), {
    label: 'Stdin Input',
    description: 'Text content to pipe to the command via stdin.',
    editor: 'code',
  }),
});

const outputSchema = outputs({
  stdout: port(z.string(), {
    label: 'Stdout',
    description: 'Raw standard output from the command.',
  }),
  stderr: port(z.string(), {
    label: 'Stderr',
    description: 'Raw standard error from the command.',
  }),
  exitCode: port(z.number(), {
    label: 'Exit Code',
    description: 'Process exit code (0 = success).',
  }),
  success: port(z.boolean(), {
    label: 'Success',
    description: 'True if exit code is 0, useful for branching.',
  }),
  lines: port(z.array(z.string()), {
    label: 'Lines',
    description: 'Stdout split into an array of lines.',
  }),
  json: port(z.any().optional(), {
    label: 'JSON',
    description: 'Parsed JSON output (if stdout is valid JSON).',
    allowAny: true,
    reason: 'JSON output can be any valid JSON structure.',
  }),
  combined: port(z.string(), {
    label: 'Combined Output',
    description: 'Combined stdout and stderr output.',
  }),
});

const parameterSchema = parameters({
  image: param(
    z.enum(['alpine:latest', 'ubuntu:latest', 'debian:latest', 'custom']).default('alpine:latest'),
    {
      label: 'Docker Image',
      editor: 'select',
      description: 'Base Docker image for command execution.',
      options: [
        { value: 'alpine:latest', label: 'Alpine Linux (lightweight)' },
        { value: 'ubuntu:latest', label: 'Ubuntu (full-featured)' },
        { value: 'debian:latest', label: 'Debian (stable)' },
        { value: 'custom', label: 'Custom Image' },
      ],
    },
  ),
  customImage: param(z.string().optional(), {
    label: 'Custom Image',
    editor: 'text',
    description: 'Custom Docker image URI (used when image is set to "custom").',
    visibleWhen: { image: 'custom' },
  }),
  timeoutSeconds: param(z.number().min(1).max(3600).default(300), {
    label: 'Timeout (seconds)',
    editor: 'number',
    description: 'Maximum execution time in seconds (1-3600).',
  }),
  outputFormat: param(z.enum(['auto', 'text', 'json', 'lines']).default('auto'), {
    label: 'Output Format',
    editor: 'select',
    description: 'How to parse and present the command output.',
    options: [
      { value: 'auto', label: 'Auto-detect' },
      { value: 'text', label: 'Plain text' },
      { value: 'json', label: 'JSON' },
      { value: 'lines', label: 'Lines array' },
    ],
  }),
  shell: param(z.enum(['sh', 'bash', 'ash']).default('sh'), {
    label: 'Shell',
    editor: 'select',
    description: 'Shell interpreter to use.',
    options: [
      { value: 'sh', label: 'sh (POSIX)' },
      { value: 'bash', label: 'bash' },
      { value: 'ash', label: 'ash (Alpine)' },
    ],
  }),
  networkEnabled: param(z.boolean().default(false), {
    label: 'Network Enabled',
    editor: 'checkbox',
    description: 'Allow network access from the container.',
  }),
  failOnNonZeroExit: param(z.boolean().default(false), {
    label: 'Fail on Non-Zero Exit',
    editor: 'checkbox',
    description: 'Throw an error if the command exits with a non-zero code.',
  }),
});

const COMMAND_EXECUTOR_TIMEOUT_SECONDS = 300;

const commandExecutorRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'core.command.executor',
  label: 'Command Executor',
  category: 'core',
  retryPolicy: commandExecutorRetryPolicy,
  runner: {
    kind: 'docker',
    image: 'alpine:latest',
    entrypoint: 'sh',
    network: 'none',
    command: ['-c', 'echo "placeholder"'],
    timeoutSeconds: COMMAND_EXECUTOR_TIMEOUT_SECONDS,
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Executes shell commands in an isolated Docker container and captures output.',
  ui: {
    slug: 'command-executor',
    version: '1.0.0',
    type: 'transform',
    category: 'core',
    description: 'Execute shell commands in an isolated Docker container.',
    icon: 'Terminal',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Run data processing scripts in isolation.',
      'Execute system commands with captured output.',
      'Chain shell utilities for text processing.',
    ],
  },
  async execute({ inputs, params }, context) {
    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Command Executor runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    // Determine the Docker image to use
    const dockerImage =
      params.image === 'custom' && params.customImage ? params.customImage : params.image;

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    try {
      // Prepare input files for the volume
      const volumeFiles: Record<string, string> = {};

      if (inputs.stdinInput) {
        volumeFiles['stdin.txt'] = inputs.stdinInput;
      }

      await volume.initialize(volumeFiles);
      context.logger.info('[Command Executor] Created isolated volume.');

      // Build the command with stdin handling and output capture
      const workDir = inputs.workingDirectory || '/workspace';
      let shellCommand = inputs.command;

      // If stdin input is provided, pipe it to the command
      if (inputs.stdinInput) {
        shellCommand = `cat /inputs/stdin.txt | ${shellCommand}`;
      }

      // Wrap command to capture stdout, stderr, and exit code separately
      const wrappedCommand = `
set +e
mkdir -p ${workDir} 2>/dev/null || true
cd ${workDir} 2>/dev/null || cd /
${shellCommand} > /inputs/stdout.txt 2> /inputs/stderr.txt
EXIT_CODE=$?
echo $EXIT_CODE > /inputs/exitcode.txt
cat /inputs/stdout.txt
exit 0
`;

      // Build environment variables
      const envVars: Record<string, string> = {
        ...(baseRunner.env ?? {}),
        ...(inputs.environmentVariables ?? {}),
      };

      const runnerConfig: DockerRunnerConfig = {
        ...baseRunner,
        image: dockerImage,
        entrypoint: `/bin/${params.shell}`,
        command: ['-c', wrappedCommand],
        network: params.networkEnabled ? 'bridge' : 'none',
        timeoutSeconds: params.timeoutSeconds ?? COMMAND_EXECUTOR_TIMEOUT_SECONDS,
        env: envVars,
        volumes: [volume.getVolumeConfig('/inputs', false)],
      };

      context.logger.info(
        `[Command Executor] Executing command in ${dockerImage} with ${params.shell}`,
      );

      const result = await runComponentWithRunner(
        runnerConfig,
        async () => ({}),
        { command: inputs.command },
        context,
      );

      // Read captured outputs from volume
      const outputFiles = await volume.readFiles(['stdout.txt', 'stderr.txt', 'exitcode.txt']);
      const stdoutContent =
        typeof result === 'string' ? result : (outputFiles['stdout.txt'] ?? '');
      const stderrContent = outputFiles['stderr.txt'] ?? '';
      const exitCodeContent = outputFiles['exitcode.txt'] ?? '0';
      const exitCode = parseInt(exitCodeContent.trim(), 10) || 0;

      const success = exitCode === 0;
      const combined = stdoutContent + (stderrContent ? '\n' + stderrContent : '');

      // Parse output into lines
      const lines = stdoutContent
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line, index, arr) => index < arr.length - 1 || line.length > 0);

      // Attempt JSON parsing based on output format
      let jsonOutput: any = undefined;
      if (params.outputFormat === 'json' || params.outputFormat === 'auto') {
        try {
          const trimmed = stdoutContent.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            jsonOutput = JSON.parse(trimmed);
          }
        } catch {
          // Not valid JSON, leave as undefined
        }
      }

      // Check if we should fail on non-zero exit
      if (params.failOnNonZeroExit && !success) {
        throw new ContainerError(`Command exited with code ${exitCode}`, {
          details: {
            exitCode,
            stderr: stderrContent,
            stdout: stdoutContent,
          },
        });
      }

      context.emitProgress(`Command completed with exit code ${exitCode}`);

      return {
        stdout: stdoutContent,
        stderr: stderrContent,
        exitCode,
        success,
        lines,
        json: jsonOutput,
        combined,
      };
    } finally {
      await volume.cleanup();
      context.logger.info('[Command Executor] Cleaned up isolated volume.');
    }
  },
});

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];
type CommandExecutorInput = typeof inputSchema;
type CommandExecutorOutput = typeof outputSchema;

export type { CommandExecutorInput, CommandExecutorOutput };
