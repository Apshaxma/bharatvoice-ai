/**
 * Weather tool tests: WMO code mapping and the guaranteed-safe mock fallback
 * shape (the agent must never crash because an upstream weather API failed).
 */

import { describe, expect, test } from "bun:test";
import {
  describeWeatherCode,
  getWeather,
  type WeatherData,
} from "../src/convex/tools/weather";

describe("describeWeatherCode", () => {
  test("maps WMO codes to short human descriptions", () => {
    expect(describeWeatherCode(0)).toBe("clear");
    expect(describeWeatherCode(2)).toBe("partly cloudy");
    expect(describeWeatherCode(3)).toBe("overcast");
    expect(describeWeatherCode(45)).toBe("fog");
    expect(describeWeatherCode(61)).toBe("rain");
    expect(describeWeatherCode(71)).toBe("snow");
    expect(describeWeatherCode(80)).toBe("rain showers");
    expect(describeWeatherCode(95)).toBe("thunderstorm");
    expect(describeWeatherCode(999)).toBe("unknown");
  });
});

describe("getWeather", () => {
  test("unknown cities resolve to the deterministic mock fallback", async () => {
    const w = await getWeather("zzz-not-a-real-city-12345", "today");
    expect(w.source).toBe("mock");
    expect(typeof w.city).toBe("string");
    expect(w.date).toBe("today");
    expect(Number.isFinite(w.temperatureMax)).toBe(true);
    expect(Number.isFinite(w.temperatureMin)).toBe(true);
    expect(w.precipitationProbability).toBeGreaterThanOrEqual(0);
    expect(w.precipitationProbability).toBeLessThanOrEqual(100);
    expect(Number.isFinite(w.windSpeedMaxKmh)).toBe(true);
    expect(Number.isInteger(w.weatherCode)).toBe(true);
    expect(w.description.length).toBeGreaterThan(0);
  });

  test("tomorrow variant keeps the requested date", async () => {
    const w = await getWeather("zzz-not-a-real-city-12345", "tomorrow");
    expect(w.date).toBe("tomorrow");
    expect(Number.isInteger(w.weatherCode)).toBe(true);
  });

  test("mock fallback is deterministic per city/date", async () => {
    const a: WeatherData = await getWeather("zzz-city-alpha-1", "today");
    const b: WeatherData = await getWeather("zzz-city-alpha-1", "today");
    expect(a.temperatureMax).toBe(b.temperatureMax);
    expect(a.precipitationProbability).toBe(b.precipitationProbability);
  });
});
