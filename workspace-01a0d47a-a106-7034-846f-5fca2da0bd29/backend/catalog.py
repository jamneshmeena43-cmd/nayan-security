"""Sample catalog prices used only so the server, not the browser, prices orders.

These rows match the existing labeled sample catalog. They are not customers,
orders, payments, or settlements.
"""

SAMPLE_PRODUCTS = [
    ("dome-2mp", "Indoor dome camera, 2MP", "karni-cctv", 204900, 8, "dome-cameras"),
    ("bullet-4mp", "Outdoor bullet camera, 4MP", "karni-cctv", 359900, 5, "bullet-cameras"),
    ("wifi-indoor", "Indoor Wi-Fi camera", "rampuria-mart", 179900, 12, "wifi-cameras"),
    ("ptz-4mp", "PTZ camera, 4MP", "amber-view", 1099900, 3, "ptz-cameras"),
    ("4g-solar", "4G camera with solar panel", "desert-lens", 769900, 4, "4g-cameras"),
    ("nvr-8ch", "8-channel network recorder", "amber-view", 629900, 6, "nvr"),
    ("dvr-4ch", "4-channel DVR", "desert-lens", 329900, 7, "dvr"),
    ("hdd-2tb", "Surveillance hard disk, 2TB", "karni-cctv", 479900, 9, "hdd"),
    ("poe-8", "8-port PoE switch", "amber-view", 289900, 10, "poe-switch"),
    ("cat6-305", "CAT6 cable box, 305 m", "karni-cctv", 589900, 4, "cat6"),
    ("psu-12v", "12V camera power adapter", "rampuria-mart", 34900, 20, "power-supply"),
    ("smps-10a", "SMPS power supply, 10A", "desert-lens", 119900, 6, "power-supply"),
    ("connector-pack", "BNC and RJ45 connector pack", "karni-cctv", 49900, 15, "bnc-rj45"),
    ("sd-128", "Memory card, 128GB", "rampuria-mart", 99900, 11, "memory-card"),
    ("ups-600", "UPS for recorder, 600VA", "amber-view", 299900, 0, "ups"),
    ("kit-4", "4 camera home kit", "rampuria-mart", 1599900, 3, "cctv-kits"),
    ("mount-kit", "Mount and junction accessory set", "karni-cctv", 64900, 14, "accessories"),
]

INSTALL_EACH_PAISE = 49900
DELIVERY_HOME_PAISE = 14900


def seed_catalog(db):
    from backend.models import Product

    existing = {row.id for row in db.query(Product.id).all()}
    for pid, name, seller, price, stock, category in SAMPLE_PRODUCTS:
        if pid in existing:
            continue
        db.add(Product(
            id=pid, name=name, seller_code=seller, price_paise=price,
            stock=stock, status="PUBLISHED", is_sample=True, category=category,
        ))
    db.commit()
