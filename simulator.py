"""Simulator that mimics the cooling-system microcontroller (sensors only).

Camera stills should come from your phone IP webcam via the dashboard,
not from generated placeholder images.
"""
import argparse
import math
import random
import time
from datetime import datetime, timezone

import requests

DEFAULT_URL = "http://127.0.0.1:8000"


def send_reading(base_url: str, temperature: float, humidity: float):
    payload = {
        "temperature": round(temperature, 2),
        "humidity": round(humidity, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    last_error = None
    for attempt in range(8):
        try:
            r = requests.post(f"{base_url}/api/ingest", json=payload, timeout=10)
            r.raise_for_status()
            print(f"reading  T={payload['temperature']:5.2f} °C  RH={payload['humidity']:5.2f} %", flush=True)
            return
        except requests.RequestException as exc:
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise last_error


def run(base_url: str, interval: float, alert_demo: bool):
    print(f"Simulator (sensors only) -> {base_url}")
    print("Use the dashboard camera URL box for your phone IP webcam.")
    print("Ctrl+C to stop")
    temperature = 5.1
    humidity = 86.0
    event_cool = 0
    event_humid = 0
    while True:
        t = time.time()
        # Overlapping slow cycles + random walk so the trace is not a repeating spike pattern
        temperature += (
            0.18 * math.sin(t / 13.7)
            + 0.09 * math.sin(t / 5.3)
            + 0.05 * math.sin(t / 2.1)
            + random.gauss(0, 0.08)
        )
        humidity += (
            0.35 * math.sin(t / 11.2 + 0.8)
            + 0.22 * math.sin(t / 4.6)
            + 0.12 * math.sin(t / 1.7 + 1.4)
            + random.gauss(0, 0.18)
        )
        # Gentle pull back toward a typical cooler setpoint
        temperature += (5.0 - temperature) * 0.04
        humidity += (86.0 - humidity) * 0.03

        if event_cool > 0:
            temperature += 0.35
            event_cool -= 1
        elif alert_demo and random.random() < 0.012:
            event_cool = random.randint(4, 9)

        if event_humid > 0:
            humidity -= 0.8
            event_humid -= 1
        elif alert_demo and random.random() < 0.01:
            event_humid = random.randint(3, 7)

        temperature = max(1.5, min(11.5, temperature))
        humidity = max(58.0, min(96.0, humidity))
        send_reading(base_url, temperature, humidity)
        time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description="Cooling-system sensor simulator")
    parser.add_argument("--url", default=DEFAULT_URL, help="Backend base URL")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between readings")
    parser.add_argument("--no-alerts", action="store_true", help="Stay inside the safe range")
    args = parser.parse_args()
    run(args.url, args.interval, alert_demo=not args.no_alerts)


if __name__ == "__main__":
    main()
