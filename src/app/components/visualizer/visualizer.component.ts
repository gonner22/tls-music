import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, Renderer2, ViewChild } from '@angular/core';
import { NgbAccordionModule } from '@ng-bootstrap/ng-bootstrap';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { PRESETS } from '../../constants/presets';
import { compareNotes, playSound, preloadSounds, SOUND_TRACKS } from '../../constants/sound-util';
import { Log } from '../../models/log';
import { Preset } from '../../models/preset';
import { SerializedVisualizer } from '../../models/serialized-visualizer';
import { SharedModule } from '../../shared/shared.module';
import { StateService } from '../../services/state.service';
import { debounceTime } from 'rxjs';
import { getSettingFromStorageOrQueryParam } from '../../constants/network-utils';
import { TelestaiService } from '../../services/telestai.service';
import { TelestaiBlock } from '../../models/telestai-block';
import { INSTRUMENT_VOLUMES } from '../../constants/sound-util';
import { TimeAgoPipe } from '../../shared/time-ago.pipe';

const CAMERA_OFFSET = (Math.min(window.innerWidth, window.innerHeight) > 650 ? 250 : 350) * 2;
const SELECTED_CHAIN_LINE_WIDTH = 3;
const MAX_SECONDS_WITHOUT_BLOCK = 10;

const INSTRUMENT_RANGES: { [instrument: string]: [string, string] } = {
  'string-pizzacato': ['a2', 'c6'],
  'string-arco': ['a2', 'c5'],
  piano: ['a1', 'c6'],
};

@Component({
  selector: 'app-visualizer',
  imports: [CommonModule, SharedModule, NgbAccordionModule, TimeAgoPipe],
  standalone: true,
  templateUrl: './visualizer.component.html',
  styleUrl: './visualizer.component.scss',
})
export class VisualizerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  // options
  public networks: string[] = ['mainnet'];
  public selectedNetwork: string = 'mainnet';
  public soundTracks = SOUND_TRACKS;
  public soundTrackIndex: number = this.isSafari
    ? 0
    : localStorage.getItem('soundTrackIndex')
      ? Number(localStorage.getItem('soundTrackIndex'))
      : 0; // always C major by default
  public instruments: string[] = ['piano', 'string-pizzacato', 'string-arco'];
  public selectedInstrument: string = localStorage.getItem('selectedInstrument') || 'piano';
  public selectedTrack: string[] | undefined;
  public selectedPreset = localStorage.getItem('preset') === null ? PRESETS[0].name : (localStorage.getItem('preset') ?? PRESETS[0].name);
  public bloomStrength = localStorage.getItem('bloomStrength') === null ? 0 : parseFloat(localStorage.getItem('bloomStrength') ?? '0');
  public bloomRadius = localStorage.getItem('bloomRadius') === null ? 1.1 : parseFloat(localStorage.getItem('bloomRadius') ?? '0');
  public bloomThreshold = localStorage.getItem('bloomThreshold') === null ? 0.18 : parseFloat(localStorage.getItem('bloomThreshold') ?? '0');
  public showText = localStorage.getItem('showText') === null ? false : localStorage.getItem('showText') === 'true';
  public showBlocks = localStorage.getItem('showBlocks') === null ? true : localStorage.getItem('showBlocks') === 'true';
  public showLines = localStorage.getItem('showLines') === null ? false : localStorage.getItem('showLines') === 'true';
  public cacheTime = 14400;
  public spiralRadius = 300;
  public blockSize = 12;
  public showFog = localStorage.getItem('showFog') === null ? true : localStorage.getItem('showFog') === 'true';
  public showFps = localStorage.getItem('showFps') === null ? false : localStorage.getItem('showFps') === 'true';
  public nodeUrl = undefined;
  public soundDirection = localStorage.getItem('soundDirection') === null ? 1 : parseInt(localStorage.getItem('soundDirection') ?? '1');
  public maxDist =
    localStorage.getItem('maxDist') === null || localStorage.getItem('maxDist') === '2000'
      ? 3500
      : parseInt(localStorage.getItem('maxDist') ?? '3500');
  public telestaiBlockColor = localStorage.getItem('telestaiBlockColor') === null ? '#9c9876' : localStorage.getItem('telestaiBlockColor')!;
  public redBlockColor = localStorage.getItem('redBlockColor') === null ? '#d64045' : localStorage.getItem('redBlockColor')!;
  public selectedColor = localStorage.getItem('selectedColor') === null ? '#00ff00' : localStorage.getItem('selectedColor')!;
  public mergeSetColor = localStorage.getItem('mergeSetColor') === null ? '#ffff00' : localStorage.getItem('mergeSetColor')!;
  public lineColor = localStorage.getItem('lineColor') === null ? '#777777' : localStorage.getItem('lineColor')!;
  public lineColorSelectedParent =
    localStorage.getItem('lineColorSelectedParent') === null ? '#ffd500' : localStorage.getItem('lineColorSelectedParent')!;
  public selectedChainColor = localStorage.getItem('selectedChainColor') === null ? '#ffff00' : localStorage.getItem('selectedChainColor')!;
  public blockTextColor = localStorage.getItem('blockTextColor') === null ? '#000000' : localStorage.getItem('blockTextColor')!;
  public loadTimestamp = new Date();
  public logLevel = localStorage.getItem('logLevel') === null ? 1 : parseInt(localStorage.getItem('logLevel') ?? '1');
  public autoReconnect = localStorage.getItem('autoReconnect') === null ? true : localStorage.getItem('autoReconnect') === 'true';
  public soundEnabled: boolean = true;

  // other public
  public selectedBlock: THREE.Mesh | undefined;
  public stats: Stats;
  public zoomDirection: number = 0;
  public cameraSpeed: number = 10;
  public logs: Log[] = [
    {
      message: 'Welcome to tls-music!',
      level: 0,
      timestamp: new Date(),
      hash: undefined,
    },
  ];
  public hoveredBlock: THREE.Mesh | undefined;
  public audioUnlocked: boolean = false;
  private telestaiPollingStarted: boolean = false;

  // private
  private bloomPass!: UnrealBloomPass;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private blockHashes: string[] = [];
  private blockHashLookup: { [hash: string]: THREE.Mesh } = {};
  private lineHashes: string[] = [];
  private lineHashLookup: { [hash: string]: Line2 } = {};
  private animationId!: number;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private latestDaaScore: number | undefined;
  private initialDaaScore: number | undefined;
  private cullInterval: any;
  private cameraZoomOffset = 0;
  private soundIndex: number = 0;
  private composer!: EffectComposer;
  private preloadingSounds: boolean = false;
  private controls: OrbitControls | undefined;
  private zooming: boolean = false;
  private zoomingTimeout: any;
  private detatched = false;
  private selectedMergeSet: string[] = [];
  private jumpToZ: number | undefined;
  private selectedChain: Set<string> = new Set();
  private disableCulling = false;
  private retryConnectTimeout: any;
  private didLoad: boolean = false;
  private lastBlockHash: string | undefined;

  constructor(
    private renderer2: Renderer2,
    public stateService: StateService,
    private telestaiService: TelestaiService,
  ) {
    this.stats = new Stats();
  }

  @HostListener('window:beforeunload', ['$event']) async beforeunloadHandler(event: any) {
  }

  public get presets(): Preset[] {
    return PRESETS;
  }

  public get lineCount(): number {
    return this.lineHashes.length;
  }

  public get blockCount(): number {
    return this.blockHashes.length;
  }

  public get isSafari(): boolean {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  }

  ngOnInit() {
    this.cullInterval = setInterval(() => {
      if (this.disableCulling) {
        return;
      }
      this.cull();
    }, 2000);

    this.changeSoundTrack(this.soundTrackIndex ?? 0);

    this.watchAutoRefreshIfDisconnected();
  }

  async ngAfterViewInit() {
    this.initThreeJS();
    this.animate();
    this.renderer2.listen(this.canvasRef.nativeElement, 'click', event => this.onCanvasClick(event));
    this.renderer2.listen(this.canvasRef.nativeElement, 'pointermove', event => this.onCanvasPointerMove(event));

    window.addEventListener('resize', this.onWindowResize.bind(this));
    document.getElementById('stats-container')?.appendChild(this.stats.dom);
    this.changeShowFog(this.showFog);
    this.changeMaxDist(this.maxDist);

    // Try to unlock audio on the first user interaction
    const unlockAudio = () => {
      if (!this.audioUnlocked) {
        const ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (ctx) {
          const audioCtx = new ctx();
          const buffer = audioCtx.createBuffer(1, 1, 22050);
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(audioCtx.destination);
          if (source.start) source.start(0);
          else if ((source as any).noteOn) (source as any).noteOn(0);
          setTimeout(() => {
            audioCtx.close();
            this.setAudioUnlocked(true);
          }, 100);
        } else {
          this.setAudioUnlocked(true); // No context, assume unlocked
        }
      }
    };
    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.animationId);
    this.renderer.dispose();
    clearInterval(this.cullInterval);
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    document.getElementById('stats-container')?.removeChild(this.stats.dom);
    this.disposeScene();
  }

  public getBlockLink(hash: string): string {
    return `https://blockbook2.telestai.io/block/${hash}`;
  }

  public toggleShowUi() {
    this.stateService.showUi = !this.stateService.showUi;
    localStorage.setItem('showUi', this.stateService.showUi.toString());
  }

  public changePreset(presetName: string) {
    const preset = this.presets.find(p => p.name === presetName);
    if (!preset) {
      return;
    }
    this.changeTelestaiBlockColor(preset.telestaiBlockColor);
    this.changeSelectedColor(preset.selectedColor);
    this.changeSoundTrack(preset.soundTrackIndex ?? 0);
    this.changeInstrument(preset.selectedInstrument);
    this.changeSoundDirection(preset.soundDirection);
    this.changeBloomStrength(preset.bloomStrength);
    this.changeBloomRadius(preset.bloomRadius);
    this.changeBloomThreshold(preset.bloomThreshold);
    localStorage.setItem('preset', preset.name);
  }

  public changeLogLevel(level: number) {
    this.logLevel = level;
    localStorage.setItem('logLevel', level.toString());
    this.logs = [];
  }

  public changeSoundTrack(index: number) {
    this.soundTrackIndex = index;
    this.soundIndex = 0;
    this.selectedTrack = this.soundTracks[index].value;

    // filter out values outside of range
    const [min, max] = INSTRUMENT_RANGES[this.selectedInstrument];
    this.selectedTrack = this.selectedTrack.filter(sound => {
      const split = sound.split('/');
      const note = split[split.length - 1].split('.')[0];
      return compareNotes(note, min) >= 0 && compareNotes(note, max) <= 0;
    });

    // Reverse the track if soundDirection is -1
    if (this.soundDirection === -1) {
      this.selectedTrack.reverse();
    }

    localStorage.setItem('soundTrackIndex', index.toString());
    console.log('preloadSounds', this.selectedTrack);
    if (this.soundEnabled) {
      this.preloadingSounds = true;
      const sounds = this.selectedTrack.map(sound => sound.replace('assets/sounds/', `assets/sounds/${this.selectedInstrument}/`));
      preloadSounds(sounds).then(() => {
        this.preloadingSounds = false;
        console.log('preloadSounds done');
      });
    } else {
      this.preloadingSounds = false;
    }
  }

  public changeShowText(value: boolean) {
    this.showText = value;
    localStorage.setItem('showText', value.toString());
  }

  public changeShowBlocks(value: boolean) {
    this.showBlocks = value;
    localStorage.setItem('showBlocks', value.toString());
  }

  public changeShowLines(value: boolean) {
    this.showLines = value;
    localStorage.setItem('showLines', value.toString());

    if (value) {
      this.addAllLines();
    } else {
      this.removeAllLinesExceptSelected();
    }
  }

  public changeSpiralRadius(value: number) {
    this.spiralRadius = value;
    localStorage.setItem('spiralRadius', value.toString());
  }

  public changeBlockSize(value: number) {
    this.blockSize = value;
    localStorage.setItem('blockSize', value.toString());
  }

  public changeShowFps(value: boolean) {
    this.showFps = value;
    localStorage.setItem('showFps', value.toString());
  }

  public changeShowFog(value: boolean) {
    this.showFog = value;
    localStorage.setItem('showFog', value.toString());
    this.scene.fog = value ? new THREE.Fog(0x000000, 100, this.maxDist * 1) : null;
  }

  public changeTelestaiBlockColor(color: string) {
    this.telestaiBlockColor = color;
    localStorage.setItem('telestaiBlockColor', color);
    this.recolorItems();
  }

  public changeSelectedColor(color: string) {
    this.selectedColor = color;
    localStorage.setItem('selectedColor', color);
    this.recolorItems();
  }

  public changeLineColor(color: string) {
    this.lineColor = color;
    localStorage.setItem('lineColor', color);
    this.recolorItems();
  }

  public changeLineColorSelectedParent(color: string) {
    this.lineColorSelectedParent = color;
    localStorage.setItem('lineColorSelectedParent', color);
    this.recolorItems();
  }

  public changeSelectedChainColor(color: string) {
    this.selectedChainColor = color;
    localStorage.setItem('selectedChainColor', color);
    this.recolorItems();
  }

  public changeBlockTextColor(color: string) {
    this.blockTextColor = color;
    localStorage.setItem('blockTextColor', color);
    this.recolorItems();
  }

  public changeInstrument(instrument: string) {
    this.selectedInstrument = instrument;
    localStorage.setItem('selectedInstrument', instrument);

    if (this.soundTrackIndex !== null) {
      this.changeSoundTrack(this.soundTrackIndex ?? 0);
    }
  }

  public async changeSoundDirection(direction: number) {
    this.soundDirection = direction;
    localStorage.setItem('soundDirection', direction.toString());

    if (this.soundTrackIndex !== null) {
      this.changeSoundTrack(this.soundTrackIndex ?? 0);
    }
  }

  public changeMaxDist(value: number) {
    this.maxDist = value;
    localStorage.setItem('maxDist', value.toString());
    this.scene.fog = this.showFog ? new THREE.Fog(0x000000, 100, this.maxDist * 1) : null;
    this.camera.far = this.maxDist * 1.25;
    this.camera.updateProjectionMatrix();
  }

  public changeAutoReconnect(value: boolean) {
    this.autoReconnect = value;
    localStorage.setItem('autoReconnect', value.toString());
  }

  public resetAllSettings() {
    localStorage.clear();
    location.reload();
  }

  public setZoomDirection(amount: number) {
    if (this.zoomDirection === amount) {
      return;
    }
    this.detatched = true;
    this.zoomDirection = amount;
    this.zooming = true;
    this.jumpToZ = undefined;
    clearTimeout(this.zoomingTimeout);
    if (amount === 0) {
      this.zooming = false;
    }
  }

  public recenterCamera() {
    this.camera.position.x = 0;
    this.camera.position.y = 0;
    this.camera.position.z = this.getZ(this.latestDaaScore ?? 0) + CAMERA_OFFSET;
    this.camera.rotation.z = 0;
    this.camera.rotation.y = 0;
    this.camera.rotation.x = 0;
    this.jumpToZ = undefined;
    this.detatched = false;
    if (this.controls) {
      this.controls.target = new THREE.Vector3(this.camera.position.x, this.camera.position.y, this.camera.position.z - CAMERA_OFFSET);
      this.controls.update();
    }
  }

  public changeBloomStrength(value: number) {
    this.bloomStrength = value;
    localStorage.setItem('bloomStrength', value.toString());
  }

  public changeBloomRadius(value: number) {
    this.bloomRadius = value;
    localStorage.setItem('bloomRadius', value.toString());
  }

  public changeBloomThreshold(value: number) {
    this.bloomThreshold = value;
    localStorage.setItem('bloomThreshold', value.toString());
  }

  public deselectBlock(block: THREE.Mesh) {
    (block.material as THREE.MeshBasicMaterial).color.setHex(block.userData['originalColor']);
    this.selectedBlock = undefined;

    // remove lines
    if (!this.showLines) {
      this.removeAllLinesExceptSelected();
    }
  }

  public focusBlockWithHash(hash?: string) {
    if (!hash) {
      return;
    }
    const block = this.blockHashLookup[hash];
    if (block) {
      this.selectBlock(block);

      this.jumpToZ = this.getZ(block.userData['daaScore']) + CAMERA_OFFSET * 1.25;
      this.detatched = true;
    }
  }

  // focus the camera on the selected block using the orbit controls
  public focusBlock(block: THREE.Mesh) {
    this.controls!.target = new THREE.Vector3(block.position.x, block.position.y, block.position.z);
    this.controls!.update();
  }

  public selectBlockWithHash(hash?: string) {
    if (!hash) {
      return;
    }
    const block = this.blockHashLookup[hash];
    if (block) {
      this.selectBlock(block);
    }
  }

  public hoverBlockWithHash(hash?: string) {
    if (!hash) {
      return;
    }
    const block = this.blockHashLookup[hash];
    if (block) {
      this.hoverBlock(block);
    }
  }

  public dehoverBlock() {
    if (!this.hoveredBlock) {
      return;
    }

    // recolor the hovered block
    if (this.hoveredBlock) {
      if (this.selectedBlock?.userData['hash'] === this.hoveredBlock.userData['hash']) {
        (this.hoveredBlock.material as THREE.MeshBasicMaterial).color.setHex(parseInt(this.selectedColor.replace('#', ''), 16));
      } else {
        (this.hoveredBlock.material as THREE.MeshBasicMaterial).color.setHex(this.hoveredBlock.userData['originalColor']);
      }
    }

    // recolor blocks in the merge set
    this.selectedMergeSet.forEach((hash: string) => {
      const block = this.blockHashLookup[hash];
      if (block) {
        if (this.selectedBlock?.userData['hash'] === hash) {
          (block.material as THREE.MeshBasicMaterial).color.setHex(parseInt(this.selectedColor.replace('#', ''), 16));
        } else {
          (block.material as THREE.MeshBasicMaterial).color.setHex(block.userData['originalColor']);
        }
      }
    });
    this.selectedMergeSet = [];

    // remove lines
    if (!this.showLines) {
      this.removeAllLinesExceptSelected();
    }

    this.hoveredBlock = undefined;
  }

  private addAllLines() {
    this.blockHashes.forEach(hash => {
      const block = this.blockHashLookup[hash];
      if (block) {
        this.addLinesForBlock(block);
      }
    });
  }

  private removeAllLinesExceptSelected() {
    // console.log('removeAllLinesExceptSelected');
    const removeHashes: string[] = [];
    this.lineHashes.forEach(hash => {
      const line = this.lineHashLookup[hash];
      const from = line.userData['fromHash'];
      if (from !== this.selectedBlock?.userData['hash']) {
        this.disposeLine(line);
        delete this.lineHashLookup[hash];
        removeHashes.push(hash);
      }
    });

    this.lineHashes = this.lineHashes.filter(hash => !removeHashes.includes(hash));
  }

  private setLatestDaaScore(val: number | undefined) {
    this.latestDaaScore = val;
    if (this.initialDaaScore === undefined) {
      this.initialDaaScore = val;
    }
  }

  private selectBlock(block: THREE.Mesh) {
    if (this.selectedBlock) {
      this.deselectBlock(this.selectedBlock);
    }
    this.selectedBlock = block;
    const selectedColorNumber = parseInt(this.selectedColor.replace('#', ''), 16);
    (block.material as THREE.MeshBasicMaterial).color.setHex(selectedColorNumber);

    // add lines
    if (!this.showLines) {
      this.removeAllLinesExceptSelected();
      if (!this.lineHashes.length) {
        this.addLinesForBlock(block);
      }
    }
  }

  private hoverBlock(block: THREE.Mesh) {
    this.dehoverBlock();

    this.hoveredBlock = block;

    // color the hovered block
    const hoverColorNumber = parseInt(this.selectedColor.replace('#', ''), 16);
    (block.material as THREE.MeshBasicMaterial).color.setHex(hoverColorNumber);

    // color blocks in the merge set
    const mergeSetColorNumber = parseInt(this.mergeSetColor.replace('#', ''), 16);
    const mergeSetHashes = block.userData['mergeSetRedsHashes'].concat(block.userData['mergeSetBluesHashes']);
    this.selectedMergeSet = mergeSetHashes;
    mergeSetHashes.forEach((hash: string) => {
      const block = this.blockHashLookup[hash];
      if (block) {
        (block.material as THREE.MeshBasicMaterial).color.setHex(mergeSetColorNumber);
      }
    });

    // add lines
    if (!this.showLines && block.userData['hash'] !== this.selectedBlock?.userData['hash']) {
      this.addLinesForBlock(block);
    }
  }

  private initThreeJS() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x000000, 100, this.maxDist * 1);
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, this.maxDist * 1.25);
    this.camera.position.z = this.getZ(undefined) + CAMERA_OFFSET;

    // TODO: is this needed?
    // https://github.com/mrdoob/three.js/blob/master/examples/webgl_buffergeometry_lines.html
    // https://github.com/mrdoob/three.js/blob/master/examples/webgl_buffergeometry_indexed.html
    // const geometry = new THREE.BufferGeometry();

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvasRef.nativeElement });
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.listenToKeyEvents(window); // optional

    // Initialize EffectComposer for bloom effect if bloom strength is set
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.bloomStrength, // strength
      this.bloomRadius, // radius
      this.bloomThreshold, // threshold
    );
    this.composer.addPass(this.bloomPass);
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  private cull() {
    const now = Date.now();
    const cacheTimeMs = this.cacheTime * 1000;

    this.lineHashes = this.lineHashes.filter(hash => {
      const line = this.lineHashLookup[hash];
      if (!line) return;
      const block = this.blockHashLookup[line.userData['fromHash']];
      if (!block) return;
      const diff = now - (block.userData['timestamp'] || 0);
      if (diff > cacheTimeMs) {
        this.disposeLine(line);
        delete this.lineHashLookup[line.userData['fromHash'] + line.userData['toHash']];
        return false;
      }
      return true;
    });

    this.blockHashes = this.blockHashes.filter(hash => {
      const block = this.blockHashLookup[hash];
      if (!block) return;
      const diff = now - (block.userData['timestamp'] || 0);
      if (diff > cacheTimeMs) {
        const parents = (block.userData['parentsByLevel'] || []).flat();
        parents.forEach((parentHash: string) => {
          const lineKey = hash + parentHash;
          this.selectedChain.delete(lineKey);
        });
        this.disposeMesh(block);
        delete this.blockHashLookup[block.userData['hash']];
        return false;
      }
      return true;
    });
  }

  private animate() {
    // move zoom
    if (this.zooming) {
      this.cameraZoomOffset += this.zoomDirection;
    } else {
      this.cameraZoomOffset *= 0.8;
      if (Math.abs(this.cameraZoomOffset) < 0.1) {
        this.cameraZoomOffset = 0;
      }
    }

    this.animationId = requestAnimationFrame(() => this.animate());
    this.stats.update();

    if (!this.detatched || this.jumpToZ !== undefined || this.cameraZoomOffset !== 0) {
      const targetZ = this.detatched
        ? this.jumpToZ === undefined
          ? this.camera.position.z + this.cameraZoomOffset
          : this.jumpToZ
        : this.getZ(this.latestDaaScore ?? 0) + CAMERA_OFFSET + this.cameraZoomOffset;

      // Use lerp to create a smooth transition
      const deltaZ = (targetZ - this.camera.position.z) * 0.08; // Adjust the factor for smoothness
      this.camera.position.z += deltaZ;

      // Update the OrbitControls target to move forward with the camera's z position
      if (this.controls) {
        this.controls.target.z += deltaZ;
        this.controls.update();
      }

      // unset the jumpToZ if we are close enough
      if (this.jumpToZ !== undefined && Math.abs(this.camera.position.z - this.jumpToZ) < 1) {
        this.jumpToZ = undefined;
      }
    }

    // set the layers
    this.camera.layers.enable(1);
    this.camera.layers.enable(3);
    if (this.showBlocks) this.camera.layers.enable(0);
    else this.camera.layers.disable(0);
    if (this.showText) this.camera.layers.enable(2);
    else this.camera.layers.disable(2);

    // Update bloom effect parameters if bloom strength is set
    if (this.bloomStrength > 0) {
      this.bloomPass.strength = this.bloomStrength;
      this.bloomPass.radius = this.bloomRadius;
      this.bloomPass.threshold = this.bloomThreshold;

      // Render the scene with bloom effect
      this.composer.render();
    } else {
      // Render the scene without bloom effect
      this.renderer.render(this.scene, this.camera);
    }
  }

  private getAngle(daaScore: number | undefined): number {
    if (this.latestDaaScore === undefined || daaScore === undefined) {
      return 0;
    }
    const reduction = 4;
    return (daaScore % (360 / reduction)) * reduction;
  }

  private getZ(daaScore: number | undefined): number {
    if (this.initialDaaScore === undefined || daaScore === undefined) {
      return 0;
    }
    return (daaScore - this.initialDaaScore) * 5;
  }

  private getSoundIndexForDaaScore(daaScore: number): number {
    if (!this.selectedTrack) {
      return 0;
    }
    return daaScore % this.selectedTrack.length;
  }

  private addBlock(blockData: any, sound: boolean = true, isImport = false) {
    // if the block is already in the list, do nothing
    if (this.blockHashes.includes(blockData.header.hash)) {
      return;
    }

    this.addLog({
      message: 'New block added',
      level: 0,
      timestamp: new Date(Number(blockData.header.timestamp)),
      hash: blockData.header.hash,
    });
    // console.log('Block added', blockData);
    const daaScore = blockData.header.daaScore;

    // update the daa score if needed
    if (this.latestDaaScore === undefined || daaScore > this.latestDaaScore) {
      this.setLatestDaaScore(daaScore);
    }

    // compute the z position based on the daa score
    const z = this.getZ(daaScore);

    // create 3D block
    const geometry = new THREE.BoxGeometry(this.blockSize, this.blockSize, 1);
    const color = parseInt(this.telestaiBlockColor.replace('#', ''), 16);
    const material = new THREE.MeshBasicMaterial({ color });
    const block = new THREE.Mesh(geometry, material);
    const txCount = blockData.tx.length;
    const scale = Math.min(1 + (txCount - 1) * 0.35, 3.5);
    block.scale.set(scale, scale, 1);
    block.position.set(0, 0, z);
    block.name = blockData.header.hash;
    const blockWorkingIndex = this.blockHashes.length;
    if (isImport) {
      block.userData = blockData.header;
    } else {
      block.userData = {
        ...blockData.header,
        ...blockData.verboseData,
        originalColor: parseInt(this.telestaiBlockColor.replace('#', ''), 16),
        order: blockWorkingIndex,
        colorDescription: 'telestai',
        soundIndex: this.getSoundIndexForDaaScore(daaScore),
      };
      block.userData['transactionCount'] = block.userData['transactionIds']?.length ?? 0;
      delete block.userData['transactionIds'];
    }

    if (this.showLines) {
      this.addLinesForBlock(block);
    }

    // blue set color
    if (!isImport) {
      block.userData['mergeSetBluesHashes'].forEach((hash: string) => {
        const block = this.blockHashLookup[hash];
        if (block) {
          const telestaiBlockColorNumber = parseInt(this.telestaiBlockColor.replace('#', ''), 16);
          block.userData['originalColor'] = telestaiBlockColorNumber;
          block.userData['colorDescription'] = 'telestai';
          if (this.selectedBlock?.userData['hash'] !== hash && !this.selectedMergeSet.includes(hash)) {
            (block.material as THREE.MeshBasicMaterial).color.setHex(telestaiBlockColorNumber);
          }
          // this.createTemporaryEffect(block.position, 0xffffff);
        }
      });
      // red set color
      block.userData['mergeSetRedsHashes'].forEach((hash: string) => {
        const block = this.blockHashLookup[hash];
        if (block) {
          const redBlockColorNumber = parseInt(this.redBlockColor.replace('#', ''), 16);
          block.userData['originalColor'] = redBlockColorNumber;
          block.userData['colorDescription'] = 'red';
          if (this.selectedBlock?.userData['hash'] !== hash && !this.selectedMergeSet.includes(hash)) {
            (block.material as THREE.MeshBasicMaterial).color.setHex(redBlockColorNumber);
          }
          // this.createTemporaryEffect(block.position, 0xffffff);
        }
      });
    }
    block.layers.set(0);

    // Add block to scene
    this.scene.add(block);
    this.blockHashes.push(blockData.header.hash);
    this.blockHashLookup[blockData.header.hash] = block;

    // play sound
    if (sound && this.selectedTrack && !this.preloadingSounds && this.soundEnabled) {
      // The note index depends on the number of transactions
      const txCount = blockData.tx.length;
      const blockSoundIndex = txCount % this.selectedTrack.length;
      let soundName = this.selectedTrack[blockSoundIndex];
      soundName = soundName.replace('assets/sounds/', `assets/sounds/${this.selectedInstrument}/`);
      playSound(soundName, INSTRUMENT_VOLUMES[this.selectedInstrument]);
      this.soundIndex = (this.soundIndex + 1) % this.selectedTrack.length;
    }
  }

  private addLinesForBlock(block: THREE.Mesh) {
    // create lines from this block to its parents
    const parents = block.userData['parentsByLevel'].flat();
    let parentBlocks = this.blockHashes.filter(hash => parents.includes(hash)).map(hash => this.blockHashLookup[hash]);
    // limit to unique parents by hash
    parentBlocks = parentBlocks.filter((block, index, self) => self.findIndex(b => b.userData['hash'] === block.userData['hash']) === index);
    const lineColorNumber = parseInt(this.lineColor.replace('#', ''), 16);
    const lineColorSelectedParentNumber = parseInt(this.lineColorSelectedParent.replace('#', ''), 16);
    const selectedChainColorNumber = parseInt(this.selectedChainColor.replace('#', ''), 16);
    parentBlocks.forEach((parentBlock, index) => {
      // if the line already exists, do nothing
      const lineKey = block.userData['hash'] + parentBlock.userData['hash'];
      if (this.lineHashes.includes(lineKey)) {
        return;
      }

      const points = [block.position.x, block.position.y, block.position.z, parentBlock.position.x, parentBlock.position.y, parentBlock.position.z];
      const geometry = new LineGeometry();
      geometry.setPositions(points);
      const isSelected = block.userData['selectedParentHash'] === parentBlock.userData['hash'];
      const isSelectedChain = this.selectedChain.has(block.userData['hash'] + parentBlock.userData['hash']);
      const color = isSelectedChain ? selectedChainColorNumber : isSelected ? lineColorSelectedParentNumber : lineColorNumber;
      const material = new LineMaterial({ color, linewidth: isSelectedChain ? SELECTED_CHAIN_LINE_WIDTH : 1, fog: true });
      const line = new Line2(geometry, material);
      line.computeLineDistances();
      line.userData = { fromHash: block.userData['hash'], toHash: parentBlock.userData['hash'], originalColor: color, isSelected };
      line.layers.set(1);
      this.lineHashes.push(block.userData['hash'] + parentBlock.userData['hash']);
      this.lineHashLookup[block.userData['hash'] + parentBlock.userData['hash']] = line;
      this.scene.add(line);
    });
  }

  private onCanvasClick(event: MouseEvent) {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.blockHashes.map(hash => this.blockHashLookup[hash]));

    if (intersects.length > 0) {
      console.log('intersects:', intersects);
      const block = this.blockHashLookup[intersects[0].object.userData['hash']];
      console.log('block:', block);
      if (block) {
        this.selectBlock(block);
      }
    }
  }

  private onCanvasPointerMove(event: MouseEvent) {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.blockHashes.map(hash => this.blockHashLookup[hash]));

    if (intersects.length > 0) {
      const block = this.blockHashLookup[intersects[0].object.userData['hash']];
      if (block && block !== this.hoveredBlock) {
        this.hoverBlock(block);
      }
    } else {
      this.dehoverBlock();
    }
  }

  private colorSelectedParents(params: any, depth: number) {
    if (depth === 0) {
      return;
    }

    const addedChainBlockHashes = params.addedChainBlockHashes;
    const removedChainBlockHashes = params.removedChainBlockHashes;
    const lineColorSelectedParentNumber = parseInt(this.lineColorSelectedParent.replace('#', ''), 16);
    const lineColorNumber = parseInt(this.lineColor.replace('#', ''), 16);
    // if (parentBlock.userData['hash'] === block.userData['selectedParentHash']) {
    //   material.color.setHex(0x00ff00);
    // }

    removedChainBlockHashes.forEach((hash: string) => {
      const block = this.blockHashLookup[hash];
      if (block) {
        const selectedParentHash = block.userData['selectedParentHash'];
        const lineKey = hash + selectedParentHash;
        const line = this.lineHashLookup[lineKey];
        if (this.selectedChain.has(lineKey)) {
          this.selectedChain.delete(lineKey);
        }
        if (line) {
          const isSelected = line.userData['isSelected'];
          (line.material as LineMaterial).color.setHex(isSelected ? lineColorSelectedParentNumber : lineColorNumber);
          (line.material as LineMaterial).linewidth = 1; // Reset linewidth
        }
        const parentBlock = this.blockHashLookup[selectedParentHash];
        if (parentBlock) {
          this.colorSelectedParents({ addedChainBlockHashes: [], removedChainBlockHashes: [selectedParentHash] }, depth - 1);
        }
      }
    });

    addedChainBlockHashes.forEach((hash: string) => {
      const selectedColorNumber = parseInt(this.selectedColor.replace('#', ''), 16);
      const selectedChainColorNumber = parseInt(this.selectedChainColor.replace('#', ''), 16);
      const block = this.blockHashLookup[hash];
      if (block) {
        const selectedParentHash = block.userData['selectedParentHash'];
        const lineKey = hash + selectedParentHash;
        const line = this.lineHashLookup[lineKey];
        if (!this.selectedChain.has(lineKey)) {
          this.selectedChain.add(lineKey);
        }
        if (line) {
          if (hash === this.selectedBlock?.userData['hash']) {
            (line.material as LineMaterial).color.setHex(selectedColorNumber);
          } else {
            (line.material as LineMaterial).color.setHex(selectedChainColorNumber);
          }
          (line.material as LineMaterial).linewidth = SELECTED_CHAIN_LINE_WIDTH;
          line.userData['originalColor'] = selectedChainColorNumber;
        }
        const parentBlock = this.blockHashLookup[selectedParentHash];
        if (parentBlock) {
          this.colorSelectedParents({ addedChainBlockHashes: [selectedParentHash], removedChainBlockHashes: [] }, depth - 1);
        }
      }
    });
  }

  private disposeMesh(object: THREE.Object3D) {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      if (Array.isArray(object.material)) {
        object.material.forEach(material => material.dispose());
      } else {
        object.material.dispose();
      }
    }
    this.scene.remove(object);
  }

  private disposeLine(object: Line2) {
    object.geometry.dispose();
    object.material.dispose();
    this.scene.remove(object);
  }

  private disposeScene() {
    if (!this.scene) {
      throw new Error('Scene not initialized');
    }

    // dispose of blocks
    this.blockHashes.forEach(hash => {
      const block = this.blockHashLookup[hash];
      if (block) {
        this.disposeMesh(block);
      }
    });

    // dispose of lines
    this.lineHashes.forEach(hash => {
      const line = this.lineHashLookup[hash];
      if (line) {
        this.disposeLine(line);
      }
    });

    // dispose of the rest
    this.scene.children.forEach(child => {
      this.disposeMesh(child);
    });

    this.resetState();
  }

  // update the color of the blocks and lines based on the settings
  private recolorItems() {
    const telestaiBlockColorNumber = parseInt(this.telestaiBlockColor.replace('#', ''), 16);
    const selectedColorNumber = parseInt(this.selectedColor.replace('#', ''), 16);
    const selectedChainColorNumber = parseInt(this.selectedChainColor.replace('#', ''), 16);
    const lineColorNumber = parseInt(this.lineColor.replace('#', ''), 16);
    const lineColorSelectedParentNumber = parseInt(this.lineColorSelectedParent.replace('#', ''), 16);
    const textColorNumber = parseInt(this.blockTextColor.replace('#', ''), 16);

    this.blockHashes.forEach(hash => {
      const block = this.blockHashLookup[hash];
      if (!block) return;

      // update the material color
      if (block.userData['hash'] === this.selectedBlock?.userData['hash']) {
        (block.material as THREE.MeshBasicMaterial).color.setHex(selectedColorNumber);
      } else if (block.userData['colorDescription'] === 'telestai') {
        (block.material as THREE.MeshBasicMaterial).color.setHex(telestaiBlockColorNumber);
      }

      // update the original color
      switch (block.userData['colorDescription']) {
        case 'telestai':
          block.userData['originalColor'] = telestaiBlockColorNumber;
          break;
      }

      // update the text color
      block.children.forEach(child => {
        ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(textColorNumber);
      });
    });

    // update the line colors
    this.lineHashes.forEach(hash => {
      const line = this.lineHashLookup[hash];
      if (!line) return;
      if (line.userData['fromHash'] === this.selectedBlock?.userData['hash']) {
        (line.material as LineMaterial).color.setHex(selectedColorNumber);
      } else {
        if ((line.material as LineMaterial).linewidth === SELECTED_CHAIN_LINE_WIDTH) {
          (line.material as LineMaterial).color.setHex(selectedChainColorNumber);
        } else {
          const selected = line.userData['isSelected'];
          (line.material as LineMaterial).color.setHex(selected ? lineColorSelectedParentNumber : lineColorNumber);
        }
      }
    });
  }

  private addLog(log: Log) {
    if (this.logLevel > log.level) {
      return;
    }
    this.logs.unshift(log);
  }

  public saveToFile() {
    if (this.showLines) {
      return;
    }
    const selectedBlockHash = this.selectedBlock ? this.selectedBlock.userData['hash'] : undefined;

    if (this.selectedBlock) {
      this.deselectBlock(this.selectedBlock!);
    }

    const data: SerializedVisualizer = {
      blocks: this.blockHashes.map(hash => this.blockHashLookup[hash].userData),
      selectedChain: Array.from(this.selectedChain),
      selectedBlockHash,
      scene: this.scene.toJSON(),
    };
    const jsonString = JSON.stringify(data, (_key: string, value: any) => {
      return typeof value === 'bigint' ? `0x${value.toString(16)}` : value;
    });
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tls-music-export-${new Date().toISOString()}.json`;
    a.click();
    window.URL.revokeObjectURL(url);

    if (selectedBlockHash) {
      this.selectBlockWithHash(selectedBlockHash);
    }
  }

  private resetState() {
    this.blockHashes = [];
    this.blockHashLookup = {};
    this.lineHashes = [];
    this.lineHashLookup = {};
    this.selectedBlock = undefined;
    this.selectedMergeSet = [];
    this.selectedChain = new Set<string>();
    this.latestDaaScore = undefined;
    this.initialDaaScore = undefined;
  }

  public loadFromFile(event: any) {
    if (this.showLines) {
      return;
    }
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      this.disableCulling = true;
      console.log('file loaded');

      // Dispose of the existing scene before resetting the state
      console.log('dispose existing scene');
      this.disposeScene();

      // Reset the state before loading new content
      console.log('reset state');
      this.resetState();

      // add new content
      console.log('add new content');
      const content = e.target?.result as string;
      const data: SerializedVisualizer = JSON.parse(content, (_key: string, value: any) => {
        return typeof value === 'string' && value.startsWith('0x') ? BigInt(value) : value;
      });

      // load the scene
      console.log('load the scene');
      const loader = new THREE.ObjectLoader();
      this.scene = loader.parse(data.scene) as THREE.Scene;

      // set the block lookup
      this.blockHashes = data.blocks.map((block: any) => block.hash);
      this.blockHashes.forEach((hash: string) => {
        this.blockHashLookup[hash] = this.scene.getObjectByName(hash) as THREE.Mesh;
      });

      this.selectedChain = new Set(data.selectedChain);

      // focus the camera on the top block
      const bottomHash = this.blockHashes[0];
      const bottomBlock = this.blockHashLookup[bottomHash];
      const bottomDaaScore = bottomBlock.userData['daaScore'];
      const topHash = this.blockHashes[this.blockHashes.length - 1];
      const topBlock = this.blockHashLookup[topHash];
      const topDaaScore = topBlock.userData['daaScore'];
      this.initialDaaScore = bottomDaaScore;
      this.latestDaaScore = topDaaScore;
      console.log('topDaaScore:', topDaaScore);
      if (data.selectedBlockHash) {
        this.selectBlockWithHash(data.selectedBlockHash);
        this.focusBlockWithHash(data.selectedBlockHash);
      } else {
        this.recenterCamera();
      }

      this.didLoad = true;

      console.log('done loading');
    };
    reader.readAsText(file);
  }

  private watchAutoRefreshIfDisconnected() {
    let lastBlockTime: Date | undefined;
    setInterval(() => {
      if (this.stateService.nodeError || !this.autoReconnect || this.didLoad) {
        return;
      }
      const block = this.blockHashes.length ? this.blockHashLookup[this.blockHashes[this.blockHashes.length - 1]] : undefined;
      if (block) {
        lastBlockTime = new Date(Number(block.userData['timestamp']));
      }

      if (lastBlockTime) {
        const now = new Date();
        const diff = Math.abs(now.getTime() - lastBlockTime.getTime());
        if (diff > MAX_SECONDS_WITHOUT_BLOCK * 1000) {
          this.stateService.retryConnect$.next();
        }
      }
    }, MAX_SECONDS_WITHOUT_BLOCK * 1000);
  }

  private startTelestaiPolling() {
    this.pollTelestaiBlock();
    setInterval(() => this.pollTelestaiBlock(), 10000); // every 10 seconds
  }

  private async pollTelestaiBlock() {
    try {
      const bestHash = await this.telestaiService.getBestBlockHash();
      if (bestHash !== this.lastBlockHash) {
        this.lastBlockHash = bestHash;
        const blocksToAdd: TelestaiBlock[] = [];
        let currentHash: string | undefined = bestHash;
        let count = 0;
        // Go back up to 200 blocks or until they are already in the visualization
        while (typeof currentHash === 'string' && count < 200 && !this.blockHashLookup[currentHash]) {
          const block = await this.telestaiService.getBlock(currentHash);
          blocksToAdd.push(block);
          currentHash = block.previousblockhash;
          count++;
        }
        // Add the blocks in order from oldest to newest, with delay so they play sound
        const playBlocksSequentially = async () => {
          for (let i = blocksToAdd.length - 1; i >= 0; i--) {
            const block = blocksToAdd[i];
            this.addTelestaiBlock(block);
            await new Promise(res => setTimeout(res, 80)); // 80ms delay between blocks
          }
        };
        await playBlocksSequentially();
      }
    } catch (error) {
      console.error('Error polling Telestai block:', error);
    }
  }

  private addTelestaiBlock(blockData: TelestaiBlock) {
    const geometry = new THREE.BoxGeometry(this.blockSize, this.blockSize, 1);
    const color = parseInt(this.telestaiBlockColor.replace('#', ''), 16);
    const material = new THREE.MeshBasicMaterial({ color });
    const block = new THREE.Mesh(geometry, material);
    const txCount = blockData.tx.length;
    const scale = Math.min(1 + (txCount - 1) * 0.35, 3.5);
    block.scale.set(scale, scale, 1);
    block.name = blockData.hash;
    block.userData = {
      ...blockData,
      daaScore: blockData.height,
      timestamp: blockData.time * 1000,
      mergeSetRedsHashes: [],
      mergeSetBluesHashes: [],
      parentsByLevel: [],
      originalColor: color,
      order: 0,
      colorDescription: 'telestai',
      soundIndex: 0,
      transactionCount: blockData.tx.length,
    };
    block.layers.set(0);
    this.scene.add(block);
    this.blockHashes.push(blockData.hash);
    this.blockHashLookup[blockData.hash] = block;
    if (this.initialDaaScore === undefined) {
      this.initialDaaScore = blockData.height;
    }
    if (this.latestDaaScore === undefined || blockData.height > this.latestDaaScore) {
      this.latestDaaScore = blockData.height;
    }
    // Play sound when adding block
    if (this.selectedTrack && !this.preloadingSounds && this.soundEnabled) {
      // The note index depends on the number of transactions
      const txCount = blockData.tx.length;
      const blockSoundIndex = txCount % this.selectedTrack.length;
      let soundName = this.selectedTrack[blockSoundIndex];
      soundName = soundName.replace('assets/sounds/', `assets/sounds/${this.selectedInstrument}/`);
      playSound(soundName, INSTRUMENT_VOLUMES[this.selectedInstrument]);
      this.soundIndex = (this.soundIndex + 1) % this.selectedTrack.length;
    }
    // --- Archimedean spiral for all blocks ---
    if (this.blockHashes.length > 1) {
      const minHeight = Math.min(...this.blockHashes.map(h => this.blockHashLookup[h].userData['height']));
      this.blockHashes.forEach(hash => {
        const b = this.blockHashLookup[hash];
        const offset = b.userData['height'] - minHeight;
        const angle = offset * 0.25; // Radians, adjust for density
        const radius = 20 + offset * 3; // Adjust for separation
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);
        const z = offset * 2; // Or use 0 if you want it flat
        b.position.set(x, y, z);
      });
      // Center the camera in the center of the spiral and move it far enough away
      this.camera.position.x = 0;
      this.camera.position.y = 0;
      this.camera.position.z = this.spiralRadius * 3;
      if (this.controls) {
        this.controls.target.set(0, 0, (this.blockHashes.length * 2) / 2);
        this.controls.update();
      }
    } else {
      block.position.set(0, 0, 0);
      this.camera.position.x = 0;
      this.camera.position.y = 0;
      this.camera.position.z = 300;
      if (this.controls) {
        this.controls.target.set(0, 0, 0);
        this.controls.update();
      }
    }
  }

  setAudioUnlocked(val: boolean, withSound: boolean = true) {
    this.audioUnlocked = val;
    this.soundEnabled = withSound;
    if (val && withSound && !this.telestaiPollingStarted) {
      // Only initialize context and preload if user wants sound
      import('../../constants/sound-util').then(mod => {
        mod.getAudioContext();
        this.changeSoundTrack(this.soundTrackIndex ?? 0); // This will do the preload
        this.telestaiPollingStarted = true;
        this.startTelestaiPolling();
      });
    } else if (val && !withSound && !this.telestaiPollingStarted) {
      import('../../constants/sound-util').then(mod => {
        mod.closeAudioContext();
        this.telestaiPollingStarted = true;
        this.startTelestaiPolling();
      });
    }
  }
}
