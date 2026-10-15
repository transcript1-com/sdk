type DenoEnvType = { env: { get: (name: string) => string | undefined } };

declare const Deno: DenoEnvType;

export const readEnv = (name: string): string | undefined => {
  // eslint-disable-next-line n/prefer-global/process
  const fromProcess = globalThis.process?.env?.[name];
  if (fromProcess !== undefined) {
    return fromProcess;
  }

  try {
    return Deno.env.get(name);
  } catch {
    // no deno global or no env permission
    return undefined;
  }
};
