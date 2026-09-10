"""SQLite storage for sensor readings and the latest camera classification."""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from settings import DB_PATH, HISTORY_LIMIT

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
Base = declarative_base()


class Reading(Base):
    __tablename__ = "readings"

    id = Column(Integer, primary_key=True)
    temperature = Column(Float, nullable=False)
    humidity = Column(Float, nullable=False)
    timestamp = Column(DateTime, nullable=False)


class CameraFrame(Base):
    __tablename__ = "camera_frames"

    id = Column(Integer, primary_key=True)
    image_path = Column(String, nullable=False)
    label = Column(String, nullable=False)
    confidence = Column(Float, nullable=False)
    spoiled_probability = Column(Float, nullable=False)
    timestamp = Column(DateTime, nullable=False)
    is_spoiled = Column(Boolean, nullable=False)


def init_db():
    Base.metadata.create_all(bind=engine)


def _normalize_dt(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def save_reading(temperature: float, humidity: float, timestamp: datetime) -> Reading:
    session = SessionLocal()
    try:
        row = Reading(temperature=temperature, humidity=humidity, timestamp=_normalize_dt(timestamp))
        session.add(row)
        session.commit()
        session.refresh(row)
        return row
    finally:
        session.close()


def save_frame(
    image_path: str,
    label: str,
    confidence: float,
    spoiled_probability: float,
    timestamp: datetime,
) -> CameraFrame:
    session = SessionLocal()
    try:
        row = CameraFrame(
            image_path=image_path,
            label=label,
            confidence=confidence,
            spoiled_probability=spoiled_probability,
            timestamp=_normalize_dt(timestamp),
            is_spoiled=(label.lower() == "spoiled"),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row
    finally:
        session.close()


def latest_reading() -> Reading | None:
    session = SessionLocal()
    try:
        return session.query(Reading).order_by(Reading.id.desc()).first()
    finally:
        session.close()


def recent_readings(limit: int = HISTORY_LIMIT) -> list[Reading]:
    session = SessionLocal()
    try:
        rows = (
            session.query(Reading)
            .order_by(Reading.id.desc())
            .limit(limit)
            .all()
        )
        return list(reversed(rows))
    finally:
        session.close()


def latest_frame() -> CameraFrame | None:
    session = SessionLocal()
    try:
        return session.query(CameraFrame).order_by(CameraFrame.id.desc()).first()
    finally:
        session.close()


def get_frame(frame_id: int) -> CameraFrame | None:
    session = SessionLocal()
    try:
        return session.query(CameraFrame).filter(CameraFrame.id == frame_id).first()
    finally:
        session.close()


def recent_frames(limit: int = 20) -> list[CameraFrame]:
    session = SessionLocal()
    try:
        return (
            session.query(CameraFrame)
            .order_by(CameraFrame.id.desc())
            .limit(limit)
            .all()
        )
    finally:
        session.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)

