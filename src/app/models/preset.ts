export interface Preset {
  name: string;
  selectedInstrument: string;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  soundTrackIndex: number | null;
  soundDirection: number;
  telestaiBlockColor: string;
  selectedColor: string;
  lineColor: string;
  lineColorSelectedParent: string;
  selectedChainColor: string;
}
