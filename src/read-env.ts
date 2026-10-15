type DenoEnvType = { env: { get: (name: string) => string | undefined } };

declare const Deno: DenoEnvType;

export const readEnv = (name: string): string | undefined => {
  try {
    // eslint-disable-next-line n/prefer-global/process
    return globalThis.process?.env?.[name] ?? Deno.env.get(name);
  } catch {
    // no deno global or no env permission
    return undefined;
  }
};
