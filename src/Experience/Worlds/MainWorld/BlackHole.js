import * as THREE from 'three/webgpu'
import * as Helpers from '@experience/Utils/Helpers.js'
import Model from '@experience/Worlds/Abstracts/Model.js'
import Experience from '@experience/Experience.js'
import Debug from '@experience/Utils/Debug.js'
import State from "@experience/State.js";

import {
    sin, positionLocal, time, vec2, vec3, vec4, uv, uniform, color, fog, rangeFogFactor, texture, If, min,
    range, instanceIndex, step, mix, max, uint, varying, Fn, struct, output, emissive, diffuseColor, PI, PI2, oneMinus, cos, atan, float,
    pass, mrt, viewportDepthTexture, screenUV, linearDepth, depth, viewportLinearDepth, mod, floor, fract, smoothstep, clamp, abs, blendOverlay,
    normalView, reflect, normalize, positionViewDirection, asin, positionView, mx_rgbtohsv, mx_hsvtorgb, positionWorld,
    positionGeometry, modelWorldMatrix, objectPosition, userData, rotate, mat3, mul, mx_fractal_noise_vec3, faceDirection,
    inverse, modelViewMatrix, transformDirection, modelViewPosition, modelWorldMatrixInverse, cameraWorldMatrix,
    cameraPosition, positionWorldDirection, sub, dot, Loop, length, remap, remapClamp, lengthSq, equirectUV
} from 'three/tsl'
``
import {
    ColorRamp2_Linear, ColorRamp3_Linear, srgbToLinear, linearToSrgb, noise21, Rot, adjustTemperature, adjustHue,
    adjustSaturation, adjustLevels, fbm, hash12, brickTexture, vecToFac, mixColorHSV, emission, ColorRamp2_Constant,
    rotateZ, rotateAxis, ColorRamp3_BSpline, ColorRamp4_BSpline, whiteNoise2D, lengthSqrt, smoothRange
} from '@experience/Utils/TSL-utils.js'

export default class BlackHole extends Model {
    experience = Experience.getInstance()
    debug = this.experience.debug
    state = this.experience.state
    input = experience.input
    time = experience.time
    renderer = experience.renderer.instance
    resources = experience.resources
    sound = experience.sound
    container = new THREE.Group();

    uniforms = {
        iterations: uniform( float( 128 ) ),
        stepSize: uniform( float( 0.0071 ) ),
        noiseFactor: uniform( float( 0.01 ) ),
        power: uniform( float( 0.3 ) ),

        clamp1: uniform( float( 0.5 ) ),
        clamp2: uniform( float( 1.0 ) ),

        originRadius: uniform( float( 0.13 ) ),
        width: uniform( float( 0.03 ) ),
        uvMotion: uniform( float(0) ),

        rampCol1: uniform( color( 0.95, 0.71, 0.44 ) ),
        rampPos1: uniform( float( 0.050 ) ),
        rampCol2: uniform( color( 0.14, 0.05, 0.03 ) ),
        rampPos2: uniform( float( 0.425 ) ),
        rampCol3: uniform( color( 0,0,0 ) ),
        rampPos3: uniform( float( 1.0 ) ),

        rampEmission: uniform( float( 2.0 ) ),
        emissionColor: uniform( color(0.14, 0.129, 0.09) ),

        test1: uniform( float( 0 ) ),
        test2: uniform( float( 0 ) ),
        test3: uniform( float( 1 ) ),
        test4: uniform( float( 1 ) )
    }

    // Base values for audio modulation
    baseValues = {
        stepSize: 0.0071,
        noiseFactor: 0.01,
        power: 0.3,
        width: 0.03,
        rampEmission: 2.0
    }

    // Audio modulation multipliers (adjustable in debug)
    audioModifiers = {
        enabled: true,
        bassMultiplier: 0.5,      // Affects power (gravity)
        midMultiplier: 0.03,      // Affects noise factor
        highMultiplier: 0.08,     // Affects width
        volumeStepMultiplier: 0.002,     // Affects step size
        volumeEmissionMultiplier: 3.0,   // Affects emission
        rampPos1Multiplier: 0.1,  // Color ramp position 1
        rampPos2Multiplier: 0.2   // Color ramp position 2
    }

    constructor( parameters = {} ) {
        super()

        this.world = parameters.world
        this.camera = this.world.camera.instance
        this.scene = this.world.scene
        this.transformControls = this.world.camera.transformControls

        this.init()
        this._setDebug()

        //this.testArrays()
    }

    testArrays() {
        const buffer = new SharedArrayBuffer( 4 * Float32Array.BYTES_PER_ELEMENT );
        //const arr = new Float32Array(buffer, 0, 2);
        const arr = new Int32Array( buffer, 0, 2 );

        Atomics.store( arr, 0, 99999999999999 );

        const value = Atomics.load( arr, 0 );

        console.log( value )

    }

    init() {
        this.setModel()
    }

    postInit() {

    }

    setModel() {
        // add shpere
        const geometry = new THREE.SphereGeometry( 1, 16, 16 )

        const material = new THREE.MeshStandardNodeMaterial({
            side: THREE.DoubleSide
        })

        this.resources.items.noiseDeepTexture.wrapS = THREE.RepeatWrapping
        this.resources.items.noiseDeepTexture.wrapT = THREE.RepeatWrapping
        this.resources.items.noiseDeepTexture.needsUpdate = true

        material.colorNode = Fn(() => {
            // ==== Uniforms and constants ====
            const _step = this.uniforms.stepSize;
            const noiseAmp = this.uniforms.noiseFactor;
            const power = this.uniforms.power;
            const originRadius = this.uniforms.originRadius;
            const bandWidth = this.uniforms.width;
            const iterCount = this.uniforms.iterations;

            // ==== Geometry- and view-dependent bases ====
            const objCoords = positionGeometry.mul(vec3(1, 1, -1)).xzy; // flip Z then swizzle
            const isBackface = step(0.0, faceDirection.negate());        // 1 backface, 0 front

            // Camera as point in object space
            const camPointObj = cameraPosition.mul(modelWorldMatrix).mul(vec3(1, 1, -1)).xzy;

            // Pick coords from camera for backfaces, from geometry for frontfaces
            const startCoords = mix(objCoords, camPointObj.xyz, isBackface);

            // Incoming view direction in world, then to object-like swizzle
            const viewInWorld = normalize(sub(cameraPosition, positionWorld))
                .mul(vec3(1, 1, -1)).xzy;
            const rayDir = viewInWorld.negate(); // initial march direction

            // White noise to jitter start
            const noiseWhite = whiteNoise2D(objCoords.xy).mul(noiseAmp);
            const jitter = rayDir.mul(noiseWhite);

            // Ray initial position
            const rayPos = startCoords.sub(jitter);

            // Accumulators
            const colorAcc = vec3(0);
            const alphaAcc = float(0.0);

            // ==== Main loop ====
            Loop(iterCount, ({ i }) => {
                // Steering term toward center
                const rNorm = normalize(rayPos);
                const rLen = lengthSqrt(rayPos);
                const steerMag = _step.mul(power).div(rLen.mul(rLen));       // step*power / r^2
                const range = remapClamp(rLen, 1.0, 0.5, 0.0, 1.0);         // fade steering
                const steer = rNorm.mul(steerMag.mul(range));
                const steeredDir = rayDir.sub(steer).normalize();

                // Advance once
                const advance = rayDir.mul(_step);
                rayPos.addAssign(advance);

                // Local measures in XY plane and rotating UVs
                const xyLen = lengthSqrt(rayPos.mul(vec3(1, 1, 0)));
                const rotPhase = xyLen.mul(4.270).sub(time.mul(0.1));
                const uvAxis = vec3(0, 0, 1);
                const uvRot = rayPos.mul(rotateAxis(uvAxis, rotPhase));
                const uv = uvRot.mul(2);

                // Deep noise sample
                const noiseDeep = texture(this.resources.items.noiseDeepTexture, uv);

                // Z band shaping
                const bandMin = bandWidth.negate();
                const bandEnds = vec3(bandMin, 0.0, bandWidth);             // [-w, 0, w]
                const dz = sub(bandEnds, vec3(rayPos.z));
                const zQuad = dz.mul(dz).div(bandWidth);
                const zBand = max(bandWidth.sub(zQuad).div(bandWidth), 0.0);

                // Modulated noise amplitude
                const noiseAmp3 = noiseDeep.mul(zBand);
                const noiseAmpLen = lengthSqrt(noiseAmp3);

                // Pseudo normal via offset noise
                const uvForNormal = uv.mul(1.002);
                const noiseNormal = texture(this.resources.items.noiseDeepTexture, uvForNormal)
                    .mul(zBand);
                const noiseNormalLen = lengthSqrt(noiseNormal);

                // Color ramp evaluation
                const rampInput =
                    xyLen
                        .add(noiseAmpLen.sub(0.780).mul(1.5))
                        .add(noiseAmpLen.sub(noiseNormalLen).mul(19.750));

                const rampA = vec4(this.uniforms.rampCol1, this.uniforms.rampPos1);
                const rampB = vec4(this.uniforms.rampCol2, this.uniforms.rampPos2);
                const rampC = vec4(this.uniforms.rampCol3, this.uniforms.rampPos3);

                const baseCol = ColorRamp3_BSpline(rampInput.x, rampA, rampB, rampC);
                const emissiveCol = baseCol.mul(this.uniforms.rampEmission)
                    .add(this.uniforms.emissionColor);

                // Core suppression near origin
                const rLenNow = lengthSqrt(rayPos);
                const insideCore = rLenNow.lessThan(originRadius);
                const shadedCol = mix(emissiveCol, vec3(0), insideCore);

                // Alpha shaping
                const zAbs = abs(rayPos.z);
                const aNoise = noiseAmpLen.sub(0.750).mul(-0.60);
                const aPre = zAbs.add(aNoise);
                const aRadial = smoothRange(xyLen, 1.0, 0.0, 0.0, 1.0);
                const aBand = smoothRange(aPre, bandWidth, 0, 0, aRadial);
                const alphaLocal = mix(aBand, 1.0, insideCore);

                // Front-to-back compositing
                const oneMinusA = alphaAcc.oneMinus();
                const weight = oneMinusA.mul(vecToFac(alphaLocal));
                const newColor = mix(colorAcc, shadedCol, weight);
                const newAlpha = mix(alphaAcc, 1.0, vecToFac(alphaLocal));

                // Second advance and steering update
                rayPos.addAssign(advance);
                rayDir.assign(steeredDir);
                colorAcc.assign(newColor);
                alphaAcc.assign(newAlpha);
            });

            // ==== Environment blend on remaining transparency ====
            const dirForEnv = rayDir.mul(vec3(1, -1, 1)).xzy;
            const env = linearToSrgb(
                texture(this.resources.items.starsTexture, equirectUV(dirForEnv)).mul( this.state.uniforms.mainScene.environment.backgroundIntensity )
            );

            const trans = float(1.0).sub(alphaAcc);
            const finalRGB = mix(colorAcc, env, trans.mul(1.0));
            // const finalAlpha = mix(alphaAcc, 1.0, 1.0); // kept for clarity, output uses color only

            return srgbToLinear(finalRGB);
        })();
        material.emissiveNode = material.colorNode


        // add plane
        // const planeGeometry = new THREE.PlaneGeometry( 10, 10 )
        // const planeMaterial = new THREE.MeshStandardNodeMaterial()
        // planeMaterial.side = THREE.DoubleSide
        // planeMaterial.colorNode = Fn( () => {
        //     const backFacing = step( 0.0, faceDirection.negate() ); // 1 — backface, 0 — front
        //
        //     return backFacing
        // })()
        // planeMaterial.emissiveNode = planeMaterial.colorNode
        // const planeMesh = new THREE.Mesh( planeGeometry, planeMaterial )

        const mesh = new THREE.Mesh( geometry, material )
        this.container.add( mesh )
        //this.container.add( planeMesh )
        this.scene.add( this.container )
    }

    animationPipeline() {

    }

    resize() {

    }

    _setDebug() {
        if ( !this.debug.active ) return


        const test = uniform( 0 )

        // Audio Modifiers Folder
        const audioFolder = this.world.debugFolder.addFolder({
            title: 'Audio Modifiers',
            expanded: true
        })

        audioFolder.addBinding(this.audioModifiers, 'enabled', {
            label: 'Audio Reactive Enabled'
        })

        audioFolder.addBinding(this.audioModifiers, 'bassMultiplier', {
            label: 'Bass → Power',
            min: 0,
            max: 2,
            step: 0.01
        })

        audioFolder.addBinding(this.audioModifiers, 'midMultiplier', {
            label: 'Mid → Noise Factor',
            min: 0,
            max: 0.1,
            step: 0.001
        })

        audioFolder.addBinding(this.audioModifiers, 'highMultiplier', {
            label: 'High → Width',
            min: 0,
            max: 0.2,
            step: 0.01
        })

        audioFolder.addBinding(this.audioModifiers, 'volumeStepMultiplier', {
            label: 'Volume → Step Size',
            min: 0,
            max: 0.01,
            step: 0.0001
        })

        audioFolder.addBinding(this.audioModifiers, 'volumeEmissionMultiplier', {
            label: 'Volume → Emission',
            min: 0,
            max: 10,
            step: 0.1
        })

        audioFolder.addBinding(this.audioModifiers, 'rampPos1Multiplier', {
            label: 'Bass → Color Pos 1',
            min: 0,
            max: 0.5,
            step: 0.01
        })

        audioFolder.addBinding(this.audioModifiers, 'rampPos2Multiplier', {
            label: 'Mid → Color Pos 2',
            min: 0,
            max: 0.5,
            step: 0.01
        })

        const exampleFolder = this.world.debugFolder.addFolder( {
            title: 'Depth & Visual',
            expanded: false
        } )

        exampleFolder.addBinding( test, 'value', {
            label: 'TEST',
        } )

        exampleFolder.addBinding( this.uniforms.iterations, 'value', {
            label: 'Iterations',
        } )

        exampleFolder.addBinding( this.uniforms.stepSize, 'value', {
            label: 'Step Size',
        } )

        exampleFolder.addBinding( this.uniforms.noiseFactor, 'value', {
            label: 'Noise Factor',
            min: 0,
            max: 0.1,
            step: 0.0001
        } )

        exampleFolder.addBinding( this.uniforms.power, 'value', {
            label: 'Power',
        } )

        exampleFolder.addBinding( this.uniforms.clamp1, 'value', {
            label: 'Clamp 1',
        } )

        exampleFolder.addBinding( this.uniforms.clamp2, 'value', {
            label: 'Clamp 2',
        } )

        exampleFolder.addBinding( this.uniforms.originRadius, 'value', {
            label: 'Origin Radius',
        } )

        exampleFolder.addBinding( this.uniforms.width, 'value', {
            label: 'Width',
        } )

        exampleFolder.addBinding( this.uniforms.uvMotion, 'value', {
            label: 'UV Motion',
        } )

        exampleFolder.addBinding( this.uniforms.rampCol1, 'value', {
            label: 'Ramp Col 1',
            color: { type: 'float' },
        } )

        exampleFolder.addBinding( this.uniforms.rampPos1, 'value', {
            label: 'Ramp Pos 1',
        } )

        exampleFolder.addBinding( this.uniforms.rampCol2, 'value', {
            label: 'Ramp Col 2',
            color: { type: 'float' },
        } )

        exampleFolder.addBinding( this.uniforms.rampPos2, 'value', {
            label: 'Ramp Pos 2',
        } )

        exampleFolder.addBinding( this.uniforms.rampCol3, 'value', {
            label: 'Ramp Col 3',
            color: { type: 'float' },
        } )

        exampleFolder.addBinding( this.uniforms.rampPos3, 'value', {
            label: 'Ramp Pos 3',
        } )

        exampleFolder.addBinding( this.uniforms.rampEmission, 'value', {
            label: 'Ramp Emission',
        } )

        exampleFolder.addBinding( this.uniforms.emissionColor, 'value', {
            label: 'Emission Color',
            color: { type: 'float' },
        } )

        exampleFolder.addBinding( this.uniforms.test1, 'value', {
            label: 'Fast Test 1',
        } )

        exampleFolder.addBinding( this.uniforms.test2, 'value', {
            label: 'Fast Test 2',
        } )

        exampleFolder.addBinding( this.uniforms.test3, 'value', {
            label: 'Fast Test 3',
        } )

        exampleFolder.addBinding( this.uniforms.test4, 'value', {
            label: 'Fast Test 4',
        } )
    }

    update( deltaTime ) {
        // Audio-reactive deformation
        if (this.audioModifiers.enabled && this.sound && this.sound.microphoneActive) {
            const volume = this.sound.volume
            const levels = this.sound.levels

            // Low frequencies (bass) - affect power (gravity strength)
            const bass = (levels[0] + levels[1]) / 2
            this.uniforms.power.value = this.baseValues.power + bass * this.audioModifiers.bassMultiplier

            // Mid frequencies - affect noise factor
            const mid = (levels[2] + levels[3] + levels[4]) / 3
            this.uniforms.noiseFactor.value = this.baseValues.noiseFactor + mid * this.audioModifiers.midMultiplier

            // High frequencies - affect width
            const high = (levels[5] + levels[6] + levels[7]) / 3
            this.uniforms.width.value = this.baseValues.width + high * this.audioModifiers.highMultiplier

            // Overall volume - affect step size and emission
            this.uniforms.stepSize.value = this.baseValues.stepSize + volume * this.audioModifiers.volumeStepMultiplier
            this.uniforms.rampEmission.value = this.baseValues.rampEmission + volume * this.audioModifiers.volumeEmissionMultiplier

            // Color ramp position modulation for dynamic color shifts
            this.uniforms.rampPos1.value = 0.050 + bass * this.audioModifiers.rampPos1Multiplier
            this.uniforms.rampPos2.value = 0.425 + mid * this.audioModifiers.rampPos2Multiplier
        } else {
            // Reset to base values when audio is disabled
            this.uniforms.power.value = this.baseValues.power
            this.uniforms.noiseFactor.value = this.baseValues.noiseFactor
            this.uniforms.width.value = this.baseValues.width
            this.uniforms.stepSize.value = this.baseValues.stepSize
            this.uniforms.rampEmission.value = this.baseValues.rampEmission
            this.uniforms.rampPos1.value = 0.050
            this.uniforms.rampPos2.value = 0.425
        }
    }

}
