import L from 'leaflet'

export function teeIcon(holeNumber: number, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="tee-marker${selected ? ' marker-selected' : ''}">${holeNumber}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  })
}

export function pinIcon(selected: boolean): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="pin-marker${selected ? ' marker-selected' : ''}">
             <div class="pin-flag"></div><div class="pin-stick"></div>
           </div>`,
    iconSize: [26, 34],
    iconAnchor: [4, 32]
  })
}
