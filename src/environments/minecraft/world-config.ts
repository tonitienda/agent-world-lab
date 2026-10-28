import nbt from "prismarine-nbt";
import { readFileSync } from "node:fs";

export type WorldPreset = "superflat" | "survival";
export function worldSettings(preset: string, seed: string) {
  if (preset !== "superflat" && preset !== "survival")
    throw Error("Unknown world preset");
  if (
    !/^-?\d{1,19}$/.test(seed) ||
    BigInt(seed) < -(2n ** 63n) ||
    BigInt(seed) >= 2n ** 63n
  )
    throw Error("Seed must be a signed 64-bit integer");
  return {
    preset: preset as WorldPreset,
    seed: BigInt(seed).toString(),
    levelType: preset === "survival" ? "minecraft:normal" : "minecraft:flat",
    generatorSettings:
      preset === "survival"
        ? ""
        : JSON.stringify({
            biome: "minecraft:plains",
            layers: [
              { block: "minecraft:bedrock", height: 1 },
              { block: "minecraft:stone", height: 70 },
              { block: "minecraft:dirt", height: 2 },
              { block: "minecraft:grass_block", height: 1 },
            ],
          }),
    difficulty: preset === "survival" ? "normal" : "peaceful",
  };
}
export function readWorldConfig(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { verified: false, reason: "No reset manifest" };
  }
}
export function verifyProperties(
  text: string,
  settings: ReturnType<typeof worldSettings>,
) {
  const properties = Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const at = l.indexOf("=");
        return [l.slice(0, at), l.slice(at + 1).replaceAll("\\:", ":")];
      }),
  );
  for (const [key, value] of Object.entries({
    "level-type": settings.levelType,
    "level-seed": settings.seed,
    "generator-settings": settings.generatorSettings,
    gamemode: "survival",
    difficulty: settings.difficulty,
    "online-mode": "false",
    "enable-rcon": "false",
  })) {
    // Vanilla canonicalizes an empty normal-world generator configuration to {}.
    if (
      key === "generator-settings" &&
      settings.preset === "survival" &&
      properties[key] !== ""
    ) {
      if (JSON.stringify(JSON.parse(properties[key])) === "{}") continue;
    }
    if (properties[key] !== value)
      throw Error(`Unexpected server property ${key}: ${properties[key]}`);
  }
}

/** Inspect the generated world, rather than trusting properties that may describe an older world. */
export async function verifyLevelDat(
  file: string,
  settings: ReturnType<typeof worldSettings>,
) {
  const { parsed } = await nbt.parse(readFileSync(file));
  const generation = nbt.simplify(parsed).Data.WorldGenSettings;
  const actual =
    generation?.dimensions?.["minecraft:overworld"]?.generator?.type;
  const expected =
    settings.preset === "survival" ? "minecraft:noise" : "minecraft:flat";
  if (actual !== expected)
    throw Error(`Generated overworld uses ${actual}; expected ${expected}`);
  const words = generation.seed as [number, number];
  const seed = BigInt.asIntN(
    64,
    (BigInt(words[0] >>> 0) << 32n) | BigInt(words[1] >>> 0),
  ).toString();
  if (seed !== settings.seed)
    throw Error(
      `Generated seed ${seed} differs from requested ${settings.seed}`,
    );
}
