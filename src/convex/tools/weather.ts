/**
 * Weather tool for BharatVoice AI.
 *
 * Uses Open-Meteo (free, no API key) for geocoding + forecasts, with a
 * deterministic mock fallback so the agent pipeline runs offline and in tests.
 *
 * Pure module — no Convex imports — so it can be unit-tested directly.
 */

export interface WeatherData {
  city: string;
  date: "today" | "tomorrow" | string;
  temperatureMax: number;
  temperatureMin: number;
  precipitationProbability: number;
  windSpeedMaxKmh: number;
  /** Short English description, e.g. "rain" | "clear" | "partly cloudy". */
  description: string;
  /** WMO weather code (https://open-meteo.com/en/docs) */
  weatherCode: number;
  source: "open-meteo" | "mock";
}

/** Map WMO codes → short human descriptions. */
export function describeWeatherCode(code: number): string {
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code >= 45 && code <= 48) return "fog";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain showers";
  if (code >= 85 && code <= 86) return "snow showers";
  if (code >= 95) return "thunderstorm";
  return "unknown";
}

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

interface GeoResult {
  latitude?: number;
  longitude?: number;
  name?: string;
}

async function geocodeCity(city: string): Promise<GeoResult | null> {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", city);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  const body = (await response.json()) as { results?: GeoResult[] };
  return body.results?.[0] ?? null;
}

function forecastDate(date: string): string {
  const d = new Date();
  if (date === "tomorrow") d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function buildMockWeather(city: string, date: string): WeatherData {
  // Deterministic-ish per city so repeated calls feel stable, but varied.
  const seed = city.length * 7 + (date === "tomorrow" ? 13 : 0);
  const temperatureMax = 26 + (seed % 8);
  const temperatureMin = 18 + (seed % 5);
  const precipitationProbability = 10 + ((seed * 3) % 70);
  const weatherCode = seed % 5 === 0 ? 61 : seed % 3 === 0 ? 3 : 1;
  return {
    city,
    date,
    temperatureMax,
    temperatureMin,
    precipitationProbability,
    windSpeedMaxKmh: 8 + (seed % 14),
    description: describeWeatherCode(weatherCode),
    weatherCode,
    source: "mock",
  };
}

/**
 * Fetch weather for a city. Never throws — returns a mock fallback when the
 * upstream API is unreachable so the agent stays functional.
 */
export async function getWeather(city: string, date = "today"): Promise<WeatherData> {
  const cleanCity = city.trim();
  if (!cleanCity) return buildMockWeather("Mumbai", date);

  try {
    const geo = await geocodeCity(cleanCity);
    if (!geo?.latitude || !geo.longitude) return buildMockWeather(cleanCity, date);

    const url = new URL(FORECAST_URL);
    url.searchParams.set("latitude", String(geo.latitude));
    url.searchParams.set("longitude", String(geo.longitude));
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("start_date", forecastDate(date));
    url.searchParams.set("end_date", forecastDate(date));

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return buildMockWeather(cleanCity, date);

    const body = (await response.json()) as {
      daily?: {
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: (number | null)[];
        wind_speed_10m_max?: number[];
      };
    };
    const daily = body.daily;
    if (!daily) return buildMockWeather(cleanCity, date);

    const weatherCode = daily.weather_code?.[0] ?? 1;
    return {
      city: geo.name ?? cleanCity,
      date,
      temperatureMax: Math.round(daily.temperature_2m_max?.[0] ?? 0),
      temperatureMin: Math.round(daily.temperature_2m_min?.[0] ?? 0),
      precipitationProbability: Math.round(daily.precipitation_probability_max?.[0] ?? 0),
      windSpeedMaxKmh: Math.round(daily.wind_speed_10m_max?.[0] ?? 0),
      description: describeWeatherCode(weatherCode),
      weatherCode,
      source: "open-meteo",
    };
  } catch {
    // Network failure / timeout — degrade gracefully, never crash the agent.
    return buildMockWeather(cleanCity, date);
  }
}
