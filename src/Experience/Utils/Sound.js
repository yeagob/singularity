import * as THREE from 'three/webgpu'
import EventEmitter from './EventEmitter.js'
import Experience from '@experience/Experience.js'
import Debug from './Debug.js'
import Sizes from './Sizes.js'


import {
    sin, positionLocal, time, vec2, vec3, vec4, uv, uniform, color, fog, rangeFogFactor,
    texture, If, min, range, instanceIndex, step,
    mix, max, uint, varying, varyingProperty, Fn, struct, output, emissive, diffuseColor, PI, PI2,
    oneMinus, cos, atan, float, pass, mrt, assign, normalize, mul, log2, length, pow, smoothstep,
    screenUV, distance, instancedArray, instancedBufferAttribute, attribute, attributeArray, pointUV,
    select, equals, deltaTime, oscSine, hash, materialColor
} from 'three/tsl'

export default class Sound extends EventEmitter {
    constructor() {
        super()

        this.experience = Experience.getInstance()
        this.postProcess = this.experience.postProcess
        //this.camera = this.experience.camera.instance
        this.resources = this.experience.resources
        //this.renderer = this.experience.renderer.instance
        this.debug = this.experience.debug
        this.sizes = this.experience.sizes
        this.isMobile = this.experience.isMobile

        this.soundsCreated = false;
        this.microphoneActive = false;

        this.fftSize = 128

        this.floatTimeDomainData = new Float32Array( this.fftSize )
        this.byteFrequencyData = new Uint8Array( this.fftSize )

        this.volume = 0
        this.levels = new Array(8).fill(0)

        // Audio source mode: 'microphone' or 'music'
        this.audioMode = 'microphone'
        this.musicLoaded = false
        this.isPlaying = false

        // Debug controls
        this.debugLogEnabled = false
        this.lastDebugLog = 0

        this.uniforms = {
            tAudioDataBackground: uniform( 0 )
        }

        //this.createSounds()
        this.setupMicrophone()
    }

    isTabVisible() {
        return document.visibilityState === "visible";
    }

    handleVisibilityChange() {
        if ( this.isTabVisible() ) {
            this.backgroundSound.play();
            this.listener.setMasterVolume( 1 )
        } else {
            this.backgroundSound.pause();
            this.listener.setMasterVolume( 0 )
        }
    }

    async setupMicrophone() {
        if( this.isMobile )
            return

        try {
            console.log('Requesting microphone access...')

            // Request microphone - IGUAL que el código que funciona
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            })

            console.log('Microphone access granted!')

            // Create audio context - IGUAL que el código que funciona
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            })

            console.log('AudioContext state:', this.audioContext.state)

            // Resume if suspended - IGUAL que el código que funciona
            if (this.audioContext.state === 'suspended') {
                console.log('⚠️ AudioContext is suspended. Click anywhere on page to activate...')
                // Will be resumed on click
            }

            // Create source from stream - IGUAL que el código que funciona
            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)

            // Create gain node - IGUAL que el código que funciona
            this.inputNode = this.audioContext.createGain()

            // Create analyser - ESTO ES LO QUE AGREGAMOS NOSOTROS
            this.analyserNode = this.audioContext.createAnalyser()
            this.analyserNode.fftSize = this.fftSize
            this.analyserNode.smoothingTimeConstant = 0.8

            // Create script processor (helps keep audio flowing) - IGUAL que el código que funciona
            const bufferSize = 256
            this.scriptProcessorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1)
            this.scriptProcessorNode.onaudioprocess = () => {
                // Keep audio processing active
            }

            // CADENA DE CONEXIÓN - Similar al código que funciona pero con analyser:
            // mediaStream → sourceNode → inputNode → analyserNode → scriptProcessor → destination
            this.sourceNode.connect(this.inputNode)
            this.inputNode.connect(this.analyserNode)
            this.analyserNode.connect(this.scriptProcessorNode)
            this.scriptProcessorNode.connect(this.audioContext.destination)

            this.microphoneActive = true

            console.log('✅ Microphone connected successfully!')
            console.log('Audio chain: source → gain → analyser → processor → destination')
            console.log('Analyser FFT size:', this.analyserNode.fftSize)
            console.log('Analyser frequency bin count:', this.analyserNode.frequencyBinCount)

            // Setup click listener to resume audio context
            this.setupClickToResume()

        } catch (error) {
            console.error('❌ Could not access microphone:', error)
            this.microphoneActive = false
        }
    }

    setupClickToResume() {
        const resumeAudio = async () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume()
                    console.log('✅ AudioContext resumed! State:', this.audioContext.state)
                } catch (err) {
                    console.error('Failed to resume AudioContext:', err)
                }
            }
        }

        // Resume on any click
        document.addEventListener('click', resumeAudio, { once: true })
        // Also try on any key press
        document.addEventListener('keydown', resumeAudio, { once: true })
    }

    async loadMusicFile(file) {
        try {
            console.log('Loading music file:', file.name)

            // Create AudioContext if not exists
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 44100 // Higher sample rate for music
                })
            }

            // Resume if suspended
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume()
            }

            // Read file as ArrayBuffer
            const arrayBuffer = await file.arrayBuffer()

            // Decode audio data
            console.log('Decoding audio file...')
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)
            console.log('✅ Audio decoded successfully!')
            console.log('Duration:', audioBuffer.duration.toFixed(2), 'seconds')
            console.log('Sample Rate:', audioBuffer.sampleRate)
            console.log('Channels:', audioBuffer.numberOfChannels)

            this.audioBuffer = audioBuffer
            this.musicLoaded = true

            return true
        } catch (error) {
            console.error('❌ Error loading music file:', error)
            return false
        }
    }

    setupMusicPlayback() {
        if (!this.audioBuffer || !this.audioContext) {
            console.error('No audio buffer loaded')
            return
        }

        try {
            // Disconnect existing music nodes if any
            if (this.musicSourceNode) {
                this.musicSourceNode.stop()
                this.musicSourceNode.disconnect()
            }

            // Create buffer source
            this.musicSourceNode = this.audioContext.createBufferSource()
            this.musicSourceNode.buffer = this.audioBuffer
            this.musicSourceNode.loop = true // Loop the song

            // Create gain node for music
            if (!this.musicGainNode) {
                this.musicGainNode = this.audioContext.createGain()
                this.musicGainNode.gain.value = 0.5 // 50% volume
            }

            // Create analyser if not exists
            if (!this.analyserNode) {
                this.analyserNode = this.audioContext.createAnalyser()
                this.analyserNode.fftSize = this.fftSize
                this.analyserNode.smoothingTimeConstant = 0.8
            }

            // Connect: source → gain → analyser → destination
            this.musicSourceNode.connect(this.musicGainNode)
            this.musicGainNode.connect(this.analyserNode)
            this.analyserNode.connect(this.audioContext.destination)

            console.log('✅ Music playback setup complete')
            console.log('Audio chain: musicSource → gain → analyser → destination')

        } catch (error) {
            console.error('❌ Error setting up music playback:', error)
        }
    }

    playMusic() {
        if (!this.musicLoaded) {
            console.warn('No music loaded')
            return
        }

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume()
        }

        this.setupMusicPlayback()
        this.musicSourceNode.start(0)
        this.isPlaying = true

        console.log('▶️ Playing music...')
    }

    pauseMusic() {
        if (this.musicSourceNode && this.isPlaying) {
            this.musicSourceNode.stop()
            this.isPlaying = false
            console.log('⏸️ Music paused')
        }
    }

    switchToMicrophone() {
        console.log('Switching to microphone...')

        // Pause music if playing
        if (this.isPlaying) {
            this.pauseMusic()
        }

        // Disconnect music chain if exists
        if (this.musicGainNode) {
            this.musicGainNode.disconnect()
        }

        // Reconnect microphone chain
        if (this.inputNode && this.analyserNode) {
            this.inputNode.disconnect()
            this.inputNode.connect(this.analyserNode)

            if (!this.scriptProcessorNode) {
                this.scriptProcessorNode = this.audioContext.createScriptProcessor(256, 1, 1)
                this.scriptProcessorNode.onaudioprocess = () => {}
            }

            this.analyserNode.connect(this.scriptProcessorNode)
            this.scriptProcessorNode.connect(this.audioContext.destination)
        }

        this.audioMode = 'microphone'
        console.log('✅ Switched to microphone')
    }

    switchToMusic() {
        console.log('Switching to music...')

        if (!this.musicLoaded) {
            console.warn('No music loaded. Please load a file first.')
            return
        }

        // Disconnect microphone chain
        if (this.inputNode) {
            this.inputNode.disconnect()
        }
        if (this.scriptProcessorNode) {
            this.scriptProcessorNode.disconnect()
        }

        // Setup and play music
        this.audioMode = 'music'

        if (!this.isPlaying) {
            this.playMusic()
        }

        console.log('✅ Switched to music')
    }

    createSounds() {
        if ( this.soundsCreated === true )
            return

        if( this.isMobile )
            return

        this.listener = new THREE.AudioListener();
        //this.camera.add( this.listener );

        this.backgroundSound = new THREE.Audio( this.listener );
        this.backgroundSound.setBuffer( this.resources.items.backgroundSound );
        this.backgroundSound.setLoop( true );
        this.backgroundSound.setVolume( 0.8 );
        //this.backgroundSound.play();
        //this.backgroundSound.pause();

        this.backgroundSoundAnalyser = new THREE.AudioAnalyser( this.backgroundSound, this.fftSize );


        this.soundsCreated = true;

        document.addEventListener( 'visibilitychange', () => this.handleVisibilityChange(), false );

        // window.addEventListener('blur', () => this.backgroundSound.pause());
        // window.addEventListener('focus', () => {
        //     if (isTabVisible()) {
        //         this.backgroundSound.play();
        //     }
        // });

    }

    getLevels() {
        const bufferLength = this.fftSize
        const levelCount = 8
        const levelBins = Math.floor( bufferLength / levelCount )

        const levels = []
        let max = 0

        for ( let i = 0; i < levelCount; i++ ) {
            let sum = 0

            for ( let j = 0; j < levelBins; j++ ) {
                sum += this.byteFrequencyData[ ( i * levelBins ) + j ]
            }

            const value = sum / levelBins / 256
            levels[ i ] = value

            if ( value > max )
                max = value
        }

        return levels
    }

    getVolume() {
        let sumSquares = 0.0
        for ( const amplitude of this.floatTimeDomainData ) {
            sumSquares += amplitude * amplitude
        }

        return Math.sqrt( sumSquares / this.floatTimeDomainData.length )
    }

    update() {
        if( this.isMobile )
            return

        // Update microphone audio data usando analyserNode directamente
        if( this.microphoneActive && this.analyserNode ) {
            this.analyserNode.getByteFrequencyData( this.byteFrequencyData )
            this.analyserNode.getFloatTimeDomainData( this.floatTimeDomainData )

            this.volume = this.getVolume()
            this.levels = this.getLevels()

            // Debug: log volume and levels periodically
            if (this.debugLogEnabled && Date.now() - this.lastDebugLog > 500) {
                console.log('🎤 Volume:', this.volume.toFixed(3),
                           '| Levels:', this.levels.map(l => l.toFixed(2)).join(', '),
                           '| AudioContext:', this.audioContext?.state)
                this.lastDebugLog = Date.now()
            }
        }
    }

    resize() {

    }

    destroy() {
        console.log('Sound cleanup: Disconnecting audio resources...')

        this.microphoneActive = false

        if (this.scriptProcessorNode) {
            this.scriptProcessorNode.disconnect()
            this.scriptProcessorNode.onaudioprocess = null
            this.scriptProcessorNode = null
        }

        if (this.analyserNode) {
            this.analyserNode.disconnect()
            this.analyserNode = null
        }

        if (this.inputNode) {
            this.inputNode.disconnect()
            this.inputNode = null
        }

        if (this.sourceNode) {
            this.sourceNode.disconnect()
            this.sourceNode = null
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => {
                track.stop()
                console.log('Stopped media track:', track.kind)
            })
            this.mediaStream = null
        }

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().then(() => {
                console.log('AudioContext closed.')
            }).catch(err => {
                console.error('Error closing AudioContext:', err)
            })
        }
    }

    postInit() {
        console.log('Sound.postInit() called', {
            debugExists: !!this.debug,
            debugActive: this.debug?.active,
            debugPanelExists: !!this.debug?.panel,
            microphoneActive: this.microphoneActive
        })

        // Setup debug UI after everything is initialized
        if (this.debug && this.debug.active && this.microphoneActive) {
            this._setupDebug()
        }
    }

    _setupDebug() {
        console.log('Sound._setupDebug() called')
        if (!this.debug.active || !this.debug.panel) {
            console.warn('Cannot create debug panel:', {
                debugActive: this.debug.active,
                panelExists: !!this.debug.panel
            })
            return
        }

        // ===== MUSIC PLAYER FOLDER =====
        const musicFolder = this.debug.panel.addFolder({
            title: '🎵 Music Player',
            expanded: true
        })

        // File input for loading music
        const fileInput = document.createElement('input')
        fileInput.type = 'file'
        fileInput.accept = 'audio/*'
        fileInput.style.display = 'none'
        document.body.appendChild(fileInput)

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0]
            if (file) {
                const success = await this.loadMusicFile(file)
                if (success) {
                    console.log('✅ Music file loaded:', file.name)
                }
            }
        })

        musicFolder.addButton({
            title: '📁 Load Music File'
        }).on('click', () => {
            fileInput.click()
        })

        const musicControls = {
            mode: this.audioMode,
            volume: 50,
            isPlaying: false
        }

        musicFolder.addBinding(musicControls, 'mode', {
            label: 'Audio Source',
            options: {
                'Microphone': 'microphone',
                'Music': 'music'
            }
        }).on('change', (ev) => {
            if (ev.value === 'microphone') {
                this.switchToMicrophone()
            } else if (ev.value === 'music') {
                this.switchToMusic()
            }
            musicControls.mode = ev.value
        })

        musicFolder.addButton({
            title: '▶️ Play Music'
        }).on('click', () => {
            if (this.audioMode === 'music') {
                this.playMusic()
                musicControls.isPlaying = true
            } else {
                this.switchToMusic()
                musicControls.mode = 'music'
            }
        })

        musicFolder.addButton({
            title: '⏸️ Pause Music'
        }).on('click', () => {
            this.pauseMusic()
            musicControls.isPlaying = false
        })

        musicFolder.addBinding(musicControls, 'volume', {
            label: 'Music Volume',
            min: 0,
            max: 100,
            step: 1
        }).on('change', (ev) => {
            if (this.musicGainNode) {
                this.musicGainNode.gain.value = ev.value / 100
            }
        })

        // ===== MICROPHONE DEBUG FOLDER =====
        const soundFolder = this.debug.panel.addFolder({
            title: '🎤 Microphone & Audio Debug',
            expanded: false
        })

        const debugData = {
            volume: 0,
            bass: 0,
            mid: 0,
            high: 0,
            micActive: this.microphoneActive
        }

        soundFolder.addBinding(debugData, 'micActive', {
            label: '✅ Microphone Active',
            readonly: true
        })

        soundFolder.addBinding(debugData, 'volume', {
            label: '🔊 Volume',
            readonly: true,
            min: 0,
            max: 1,
            view: 'graph',
            min: 0,
            max: 1
        })

        soundFolder.addBinding(debugData, 'bass', {
            label: '🎵 Bass (Low Freq)',
            readonly: true,
            min: 0,
            max: 1,
            view: 'graph'
        })

        soundFolder.addBinding(debugData, 'mid', {
            label: '🎼 Mid Freq',
            readonly: true,
            min: 0,
            max: 1,
            view: 'graph'
        })

        soundFolder.addBinding(debugData, 'high', {
            label: '🎹 High Freq',
            readonly: true,
            min: 0,
            max: 1,
            view: 'graph'
        })

        soundFolder.addBinding(this, 'debugLogEnabled', {
            label: '📝 Console Log'
        })

        // Add a button to activate AudioContext
        soundFolder.addButton({
            title: '▶️ ACTIVATE AUDIO (Click if no sound)'
        }).on('click', async () => {
            console.log('=== ACTIVATING AUDIO ===')
            if (this.audioContext) {
                console.log('AudioContext state before:', this.audioContext.state)
                if (this.audioContext.state === 'suspended') {
                    await this.audioContext.resume()
                    console.log('AudioContext state after:', this.audioContext.state)
                    console.log('✅ Audio activated! Try speaking now.')
                } else {
                    console.log('ℹ️ AudioContext already running:', this.audioContext.state)
                }
            }
        })

        // Add a button to test microphone
        soundFolder.addButton({
            title: '🧪 Test Audio Data'
        }).on('click', () => {
            console.log('=== AUDIO TEST ===')
            console.log('Microphone Active:', this.microphoneActive)
            console.log('AudioContext state:', this.audioContext?.state)
            console.log('Current Volume:', this.volume)
            console.log('Current Levels:', this.levels)
            console.log('Analyser exists:', !!this.analyserNode)
            if (this.analyserNode) {
                console.log('FFT Size:', this.analyserNode.fftSize)
                console.log('Frequency Bin Count:', this.analyserNode.frequencyBinCount)
                console.log('Frequency Bin 0-20:', Array.from(this.byteFrequencyData.slice(0, 20)))
                console.log('Time Domain Sample 0-20:', Array.from(this.floatTimeDomainData.slice(0, 20)))
            }
        })

        // Update debug values
        this.experience.time.on('tick', () => {
            if (this.microphoneActive) {
                debugData.volume = this.volume
                debugData.bass = (this.levels[0] + this.levels[1]) / 2
                debugData.mid = (this.levels[2] + this.levels[3] + this.levels[4]) / 3
                debugData.high = (this.levels[5] + this.levels[6] + this.levels[7]) / 3
                debugData.micActive = this.microphoneActive
            }
        })

        console.log('🎤 Debug panel created. Speak into microphone to see values change.')
    }

}
