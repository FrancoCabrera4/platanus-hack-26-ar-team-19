type Zone = {
  name: string;
  lat: number;
  lng: number;
};

const BUENOS_AIRES_ZONES: Zone[] = [
  { name: "Agronomia, CABA", lat: -34.5923, lng: -58.4887 },
  { name: "Almagro, CABA", lat: -34.6085, lng: -58.4214 },
  { name: "Balvanera, CABA", lat: -34.6092, lng: -58.4034 },
  { name: "Barracas, CABA", lat: -34.6452, lng: -58.3774 },
  { name: "Belgrano, CABA", lat: -34.5627, lng: -58.4583 },
  { name: "Boedo, CABA", lat: -34.6302, lng: -58.4173 },
  { name: "Caballito, CABA", lat: -34.6188, lng: -58.4426 },
  { name: "Chacarita, CABA", lat: -34.588, lng: -58.4513 },
  { name: "Coghlan, CABA", lat: -34.5617, lng: -58.4745 },
  { name: "Colegiales, CABA", lat: -34.5745, lng: -58.4496 },
  { name: "Constitucion, CABA", lat: -34.6269, lng: -58.3837 },
  { name: "Flores, CABA", lat: -34.6285, lng: -58.4634 },
  { name: "Floresta, CABA", lat: -34.6282, lng: -58.4824 },
  { name: "La Boca, CABA", lat: -34.6345, lng: -58.3631 },
  { name: "Liniers, CABA", lat: -34.6428, lng: -58.5198 },
  { name: "Mataderos, CABA", lat: -34.6584, lng: -58.5019 },
  { name: "Monserrat, CABA", lat: -34.6121, lng: -58.3809 },
  { name: "Monte Castro, CABA", lat: -34.6195, lng: -58.5056 },
  { name: "Nunez, CABA", lat: -34.5487, lng: -58.4627 },
  { name: "Palermo, CABA", lat: -34.5889, lng: -58.4306 },
  { name: "Parque Chacabuco, CABA", lat: -34.6357, lng: -58.4411 },
  { name: "Parque Patricios, CABA", lat: -34.6376, lng: -58.4053 },
  { name: "Paternal, CABA", lat: -34.5969, lng: -58.4693 },
  { name: "Puerto Madero, CABA", lat: -34.6118, lng: -58.3637 },
  { name: "Recoleta, CABA", lat: -34.5883, lng: -58.3974 },
  { name: "Retiro, CABA", lat: -34.5922, lng: -58.3751 },
  { name: "Saavedra, CABA", lat: -34.5546, lng: -58.4887 },
  { name: "San Cristobal, CABA", lat: -34.6241, lng: -58.4023 },
  { name: "San Nicolas, CABA", lat: -34.6045, lng: -58.3841 },
  { name: "San Telmo, CABA", lat: -34.6215, lng: -58.3739 },
  { name: "Villa Crespo, CABA", lat: -34.5982, lng: -58.4432 },
  { name: "Villa Devoto, CABA", lat: -34.6006, lng: -58.5145 },
  { name: "Villa Lugano, CABA", lat: -34.6774, lng: -58.4759 },
  { name: "Villa Ortuzar, CABA", lat: -34.5803, lng: -58.4686 },
  { name: "Villa Urquiza, CABA", lat: -34.5736, lng: -58.4875 },
  { name: "Vicente Lopez, GBA", lat: -34.5291, lng: -58.4737 },
  { name: "Florida, GBA", lat: -34.5326, lng: -58.4916 },
  { name: "Olivos, GBA", lat: -34.5085, lng: -58.487 },
  { name: "San Isidro, GBA", lat: -34.4708, lng: -58.5286 },
  { name: "Tigre, GBA", lat: -34.4251, lng: -58.5797 },
  { name: "San Fernando, GBA", lat: -34.4416, lng: -58.5573 },
  { name: "San Martin, GBA", lat: -34.5743, lng: -58.5373 },
  { name: "Caseros, GBA", lat: -34.6035, lng: -58.5646 },
  { name: "Moron, GBA", lat: -34.6534, lng: -58.6198 },
  { name: "Ramos Mejia, GBA", lat: -34.6414, lng: -58.5659 },
  { name: "Lanus, GBA", lat: -34.7013, lng: -58.3955 },
  { name: "Avellaneda, GBA", lat: -34.6627, lng: -58.3649 },
  { name: "Quilmes, GBA", lat: -34.7203, lng: -58.2545 },
  { name: "La Plata, Buenos Aires", lat: -34.9214, lng: -57.9545 },
];

function distanceInKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const earthRadiusKm = 6371;
  const latDistance = toRadians(toLat - fromLat);
  const lngDistance = toRadians(toLng - fromLng);
  const fromLatRad = toRadians(fromLat);
  const toLatRad = toRadians(toLat);

  const a =
    Math.sin(latDistance / 2) ** 2 +
    Math.cos(fromLatRad) * Math.cos(toLatRad) * Math.sin(lngDistance / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function formatApproximateLocation(
  latitude: number,
  longitude: number,
): string {
  const closestZone = BUENOS_AIRES_ZONES.reduce(
    (closest, zone) => {
      const distance = distanceInKm(latitude, longitude, zone.lat, zone.lng);
      return distance < closest.distance ? { zone, distance } : closest;
    },
    { zone: BUENOS_AIRES_ZONES[0], distance: Number.POSITIVE_INFINITY },
  );

  if (closestZone.distance <= 35) {
    return closestZone.zone.name;
  }

  return "Mi zona actual";
}
