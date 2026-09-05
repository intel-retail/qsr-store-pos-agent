/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

interface SimEntity {
  mesh: THREE.Mesh;
  type: 'customer' | 'staff';
  targetX: number;
  targetZ: number;
  speed: number;
  state: 'wandering' | 'shopping' | 'at-checkout' | 'leaving';
  timer: number;
}

interface DollarEffect {
  sprite: THREE.Sprite;
  timer: number;
  startY: number;
}

export class GroceryScene {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private animationId = 0;
  private entities: SimEntity[] = [];
  private shelves: THREE.Object3D[] = [];
  private floor!: THREE.Mesh;
  private isActive = false;
  private clock = new THREE.Clock();
  private customerCount = 8;
  private speedMultiplier = 1;
  private checkoutCounters: THREE.Object3D[] = [];
  private dollarEffects: DollarEffect[] = [];
  private dollarTexture!: THREE.Texture;
  private orbitControls!: OrbitControls;
  private transformControls!: TransformControls;
  private selectableObjects: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private selectedObject: THREE.Object3D | null = null;

  onTransaction: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {}

  init(): void {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.setClearColor(0x87ceeb);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87ceeb, 80, 150);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 300);
    this.camera.position.set(45, 35, 45);
    this.camera.lookAt(0, 0, 0);

    // OrbitControls - rotate/zoom/pan camera
    this.orbitControls = new OrbitControls(this.camera, this.canvas);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.maxPolarAngle = Math.PI / 2.1;
    this.orbitControls.minDistance = 10;
    this.orbitControls.maxDistance = 120;

    // TransformControls - move/rotate/scale selected objects
    this.transformControls = new TransformControls(this.camera, this.canvas);
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      this.orbitControls.enabled = !event.value;
    });
    this.scene.add(this.transformControls);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(30, 40, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 100;
    dirLight.shadow.camera.left = -40;
    dirLight.shadow.camera.right = 40;
    dirLight.shadow.camera.top = 40;
    dirLight.shadow.camera.bottom = -40;
    this.scene.add(dirLight);

    // Create dollar sign texture
    this.dollarTexture = this.createDollarTexture();

    // Build the store
    this.buildStore();
    this.spawnEntities(this.customerCount);

    // Event listeners
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('keydown', this.onKeyDown);

    // Start render loop
    this.animate();
  }

  // --- Store layout based on supermarket plan ---
  private buildStore(): void {
    // Floor (60 x 50 store)
    const floorGeo = new THREE.PlaneGeometry(60, 50);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0xf5f5dc });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // Floor grid
    const gridHelper = new THREE.GridHelper(60, 30, 0xcccccc, 0xdddddd);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);

    // Walls (back, left, right — front is open for entrance)
    this.addWall(0, 2, -25, 60, 4, 0.3, 0xd4e6f1);   // Back wall
    this.addWall(-30, 2, 0, 0.3, 4, 50, 0xd4e6f1);   // Left wall
    this.addWall(30, 2, 0, 0.3, 4, 50, 0xd4e6f1);    // Right wall
    this.addWall(-15, 2, 25, 30, 4, 0.3, 0xd4e6f1);  // Front-left wall
    this.addWall(15, 2, 25, 30, 4, 0.3, 0xd4e6f1);   // Front-right wall

    // Entrance markers
    const entranceGeo = new THREE.BoxGeometry(1, 3.5, 0.5);
    const entranceMat = new THREE.MeshLambertMaterial({ color: 0x455a64 });
    const leftPost = new THREE.Mesh(entranceGeo, entranceMat);
    leftPost.position.set(-1.5, 1.75, 25);
    this.scene.add(leftPost);
    const rightPost = new THREE.Mesh(entranceGeo, entranceMat);
    rightPost.position.set(1.5, 1.75, 25);
    this.scene.add(rightPost);

    // --- SECTIONS ---

    // 1. Checkout counters (front, near entrance) - 4 lanes
    this.buildCheckoutArea();

    // 2. Produce section (right side, near entrance)
    this.buildProduceSection();

    // 3. Bakery section (left side, near entrance)
    this.buildBakerySection();

    // 4. Center aisles - dry goods, snacks, beverages (5 long parallel aisles)
    this.buildCenterAisles();

    // 5. Dairy & Frozen (along back wall)
    this.buildDairyFrozenSection();

    // 6. Meat & Seafood (right side, back)
    this.buildMeatSection();

    // Zone labels
    this.addZoneLabels();
  }

  private buildCheckoutArea(): void {
    // 4 checkout lanes at the front
    for (let i = 0; i < 4; i++) {
      const group = new THREE.Group();
      const x = -9 + i * 6;
      const z = 20;

      // Counter
      const counterGeo = new THREE.BoxGeometry(4, 1, 1.5);
      const counterMat = new THREE.MeshLambertMaterial({ color: 0x455a64 });
      const counter = new THREE.Mesh(counterGeo, counterMat);
      counter.position.set(0, 0.5, 0);
      counter.castShadow = true;
      group.add(counter);

      // Cash register
      const registerGeo = new THREE.BoxGeometry(0.6, 0.5, 0.5);
      const registerMat = new THREE.MeshLambertMaterial({ color: 0x212121 });
      const register = new THREE.Mesh(registerGeo, registerMat);
      register.position.set(1, 1.25, 0);
      register.castShadow = true;
      group.add(register);

      // Conveyor belt
      const beltGeo = new THREE.BoxGeometry(3, 0.1, 1);
      const beltMat = new THREE.MeshLambertMaterial({ color: 0x37474f });
      const belt = new THREE.Mesh(beltGeo, beltMat);
      belt.position.set(-0.5, 1.05, 0);
      group.add(belt);

      group.position.set(x, 0, z);
      this.scene.add(group);
      this.checkoutCounters.push(group);
      this.selectableObjects.push(group);
    }
  }

  private buildProduceSection(): void {
    // Open produce displays on the right side near entrance
    const produceColors = [0x4caf50, 0xff5722, 0xffeb3b, 0x8bc34a, 0xff9800, 0xe91e63];

    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      const x = 20 + i * 3.5;
      const z = 12 - i * 8;

      // Display table
      const tableGeo = new THREE.BoxGeometry(3, 0.8, 5);
      const tableMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
      const table = new THREE.Mesh(tableGeo, tableMat);
      table.position.set(0, 0.4, 0);
      table.castShadow = true;
      group.add(table);

      // Produce bins (colored items on top)
      for (let j = 0; j < 4; j++) {
        const binGeo = new THREE.BoxGeometry(0.7, 0.4, 1);
        const binMat = new THREE.MeshLambertMaterial({
          color: produceColors[Math.floor(Math.random() * produceColors.length)]
        });
        const bin = new THREE.Mesh(binGeo, binMat);
        bin.position.set(-0.8 + j * 0.8, 1, (Math.random() - 0.5) * 3);
        bin.castShadow = true;
        group.add(bin);
      }

      group.position.set(x, 0, z);
      this.scene.add(group);
      this.shelves.push(group);
      this.selectableObjects.push(group);
    }
  }

  private buildBakerySection(): void {
    // Bakery display cases on the left side near entrance
    for (let i = 0; i < 2; i++) {
      const group = new THREE.Group();
      const x = -24;
      const z = 12 - i * 8;

      // Display case
      const caseGeo = new THREE.BoxGeometry(4, 1.5, 6);
      const caseMat = new THREE.MeshLambertMaterial({ color: 0xffcc80 });
      const displayCase = new THREE.Mesh(caseGeo, caseMat);
      displayCase.position.set(0, 0.75, 0);
      displayCase.castShadow = true;
      group.add(displayCase);

      // Glass top
      const glassGeo = new THREE.BoxGeometry(3.8, 0.8, 5.8);
      const glassMat = new THREE.MeshLambertMaterial({ color: 0xbbdefb, transparent: true, opacity: 0.3 });
      const glass = new THREE.Mesh(glassGeo, glassMat);
      glass.position.set(0, 1.9, 0);
      group.add(glass);

      // Bread items
      for (let j = 0; j < 3; j++) {
        const breadGeo = new THREE.BoxGeometry(0.6, 0.3, 0.8);
        const breadMat = new THREE.MeshLambertMaterial({ color: 0xd4a057 });
        const bread = new THREE.Mesh(breadGeo, breadMat);
        bread.position.set(-0.8 + j * 0.9, 1.6, (Math.random() - 0.5) * 3);
        bread.castShadow = true;
        group.add(bread);
      }

      group.position.set(x, 0, z);
      this.scene.add(group);
      this.shelves.push(group);
      this.selectableObjects.push(group);
    }
  }

  private buildCenterAisles(): void {
    // 5 long parallel shelf aisles in the center
    const shelfColors = [0x2196f3, 0x4caf50, 0xff9800, 0x9c27b0, 0xf44336, 0x00bcd4];

    for (let aisle = 0; aisle < 5; aisle++) {
      const x = -14 + aisle * 7;

      // Each aisle has a long double-sided shelf unit
      const group = new THREE.Group();

      // Shelf structure (tall)
      const shelfGeo = new THREE.BoxGeometry(1.5, 2.5, 18);
      const shelfMat = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
      const shelf = new THREE.Mesh(shelfGeo, shelfMat);
      shelf.position.set(0, 1.25, 0);
      shelf.castShadow = true;
      shelf.receiveShadow = true;
      group.add(shelf);

      // Products on both sides
      for (let side = -1; side <= 1; side += 2) {
        for (let p = 0; p < 12; p++) {
          const prodGeo = new THREE.BoxGeometry(0.4, 0.5, 0.4);
          const prodMat = new THREE.MeshLambertMaterial({
            color: shelfColors[Math.floor(Math.random() * shelfColors.length)]
          });
          const prod = new THREE.Mesh(prodGeo, prodMat);
          prod.position.set(side * 1, 2.6, -7 + p * 1.2);
          prod.castShadow = true;
          group.add(prod);
        }
      }

      group.position.set(x, 0, -2);
      this.scene.add(group);
      this.shelves.push(group);
      this.selectableObjects.push(group);
    }
  }

  private buildDairyFrozenSection(): void {
    // Refrigerated cases along the back wall
    for (let i = 0; i < 6; i++) {
      const group = new THREE.Group();
      const x = -22 + i * 8;
      const z = -22;

      // Fridge unit
      const fridgeGeo = new THREE.BoxGeometry(6, 2.5, 2);
      const fridgeMat = new THREE.MeshLambertMaterial({ color: 0xb3e5fc });
      const fridge = new THREE.Mesh(fridgeGeo, fridgeMat);
      fridge.position.set(0, 1.25, 0);
      fridge.castShadow = true;
      group.add(fridge);

      // Glass door
      const doorGeo = new THREE.BoxGeometry(5.5, 2, 0.1);
      const doorMat = new THREE.MeshLambertMaterial({ color: 0xe1f5fe, transparent: true, opacity: 0.4 });
      const door = new THREE.Mesh(doorGeo, doorMat);
      door.position.set(0, 1.25, 1.05);
      group.add(door);

      // Items inside
      for (let j = 0; j < 4; j++) {
        const itemGeo = new THREE.BoxGeometry(0.5, 0.7, 0.4);
        const itemMat = new THREE.MeshLambertMaterial({
          color: i < 3 ? 0xffffff : 0x81d4fa // white for dairy, blue for frozen
        });
        const item = new THREE.Mesh(itemGeo, itemMat);
        item.position.set(-1.5 + j * 1.2, 1.2, 0);
        group.add(item);
      }

      group.position.set(x, 0, z);
      this.scene.add(group);
      this.shelves.push(group);
      this.selectableObjects.push(group);
    }
  }

  private buildMeatSection(): void {
    // Meat display counter on the right back area
    for (let i = 0; i < 2; i++) {
      const group = new THREE.Group();
      const x = 24;
      const z = -14 + i * 8;

      // Refrigerated counter
      const counterGeo = new THREE.BoxGeometry(4, 1.2, 6);
      const counterMat = new THREE.MeshLambertMaterial({ color: 0xef9a9a });
      const counter = new THREE.Mesh(counterGeo, counterMat);
      counter.position.set(0, 0.6, 0);
      counter.castShadow = true;
      group.add(counter);

      // Glass top
      const glassGeo = new THREE.BoxGeometry(3.8, 0.6, 5.8);
      const glassMat = new THREE.MeshLambertMaterial({ color: 0xffcdd2, transparent: true, opacity: 0.3 });
      const glass = new THREE.Mesh(glassGeo, glassMat);
      glass.position.set(0, 1.5, 0);
      group.add(glass);

      group.position.set(x, 0, z);
      this.scene.add(group);
      this.shelves.push(group);
      this.selectableObjects.push(group);
    }
  }

  private addZoneLabels(): void {
    const labels: { text: string; x: number; z: number; color: number }[] = [
      { text: 'CHECKOUT', x: 0, z: 21.5, color: 0x455a64 },
      { text: 'PRODUCE', x: 22, z: 14, color: 0x4caf50 },
      { text: 'BAKERY', x: -24, z: 14, color: 0xf57c00 },
      { text: 'GROCERY AISLES', x: 0, z: -2, color: 0x5d4037 },
      { text: 'DAIRY & FROZEN', x: -4, z: -20, color: 0x0288d1 },
      { text: 'MEAT & SEAFOOD', x: 24, z: -10, color: 0xd32f2f },
      { text: 'ENTRANCE', x: 0, z: 24.5, color: 0x388e3c },
    ];

    for (const label of labels) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.width = 512;
      canvas.height = 128;

      ctx.fillStyle = `#${label.color.toString(16).padStart(6, '0')}`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.text, canvas.width / 2, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: texture });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(label.x, 4.2, label.z);
      sprite.scale.set(6, 1.5, 1);
      this.scene.add(sprite);
    }
  }

  private addWall(x: number, y: number, z: number, w: number, h: number, d: number, color: number): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshLambertMaterial({ color });
    const wall = new THREE.Mesh(geo, mat);
    wall.position.set(x, y, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.scene.add(wall);
  }

  // --- Interactive controls ---
  private onPointerDown = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.selectableObjects, true);

    if (intersects.length > 0) {
      // Find the top-level selectable parent
      let obj: THREE.Object3D | null = intersects[0].object;
      while (obj && !this.selectableObjects.includes(obj)) {
        obj = obj.parent;
      }
      if (obj) {
        this.selectObject(obj);
      }
    } else {
      this.deselectObject();
    }
  };

  private selectObject(obj: THREE.Object3D): void {
    this.selectedObject = obj;
    this.transformControls.attach(obj);
  }

  private deselectObject(): void {
    if (this.selectedObject) {
      this.transformControls.detach();
      this.selectedObject = null;
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key.toLowerCase()) {
      case 'g': // Move (grab)
        this.transformControls.setMode('translate');
        break;
      case 'r': // Rotate
        this.transformControls.setMode('rotate');
        break;
      case 's': // Scale
        this.transformControls.setMode('scale');
        break;
      case 'escape':
        this.deselectObject();
        break;
    }
  };

  // --- Dollar sign effect ---
  private createDollarTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#4caf50';
    ctx.font = 'bold 96px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 64, 64);
    return new THREE.CanvasTexture(canvas);
  }

  private spawnDollarEffect(x: number, y: number, z: number): void {
    const mat = new THREE.SpriteMaterial({ map: this.dollarTexture, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y + 3, z);
    sprite.scale.set(1.5, 1.5, 1);
    this.scene.add(sprite);
    this.dollarEffects.push({ sprite, timer: 2, startY: y + 3 });
  }

  private updateDollarEffects(delta: number): void {
    for (let i = this.dollarEffects.length - 1; i >= 0; i--) {
      const effect = this.dollarEffects[i];
      effect.timer -= delta;
      // Float up and spin
      effect.sprite.position.y += delta * 1.5;
      effect.sprite.material.rotation += delta * 4;
      // Fade out
      effect.sprite.material.opacity = Math.max(0, effect.timer / 2);
      if (effect.timer <= 0) {
        this.scene.remove(effect.sprite);
        effect.sprite.material.dispose();
        this.dollarEffects.splice(i, 1);
      }
    }
  }

  // --- Entities ---
  private spawnEntities(numCustomers: number): void {
    for (let i = 0; i < numCustomers; i++) {
      this.spawnCustomer();
    }
    const numStaff = Math.max(2, Math.floor(numCustomers / 4));
    for (let i = 0; i < numStaff; i++) {
      this.spawnStaff();
    }
  }

  private spawnCustomer(): void {
    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.8, 1.2, 0.5);
    const bodyColor = [0xff9800, 0xffc107, 0xe91e63, 0x9c27b0, 0x00bcd4][Math.floor(Math.random() * 5)];
    const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.2;
    group.add(body);

    const headGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffcc80 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 2.1;
    group.add(head);

    const legGeo = new THREE.BoxGeometry(0.3, 0.8, 0.4);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x1565c0 });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.2, 0.4, 0);
    group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.2, 0.4, 0);
    group.add(rightLeg);

    const cartGeo = new THREE.BoxGeometry(0.6, 0.4, 0.4);
    const cartMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9e });
    const cart = new THREE.Mesh(cartGeo, cartMat);
    cart.position.set(0.7, 0.8, 0);
    group.add(cart);

    const x = (Math.random() - 0.5) * 40;
    const z = (Math.random() - 0.5) * 35;
    group.position.set(x, 0, z);
    group.castShadow = true;

    this.scene.add(group);
    this.entities.push({
      mesh: group as any,
      type: 'customer',
      targetX: (Math.random() - 0.5) * 40,
      targetZ: (Math.random() - 0.5) * 35,
      speed: 1.5 + Math.random() * 1.5,
      state: 'wandering',
      timer: 2 + Math.random() * 5
    });
  }

  private spawnStaff(): void {
    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.8, 1.2, 0.5);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x4caf50 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.2;
    group.add(body);

    const headGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffcc80 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 2.1;
    group.add(head);

    const capGeo = new THREE.BoxGeometry(0.65, 0.15, 0.65);
    const capMat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 2.45;
    group.add(cap);

    const legGeo = new THREE.BoxGeometry(0.3, 0.8, 0.4);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x212121 });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.2, 0.4, 0);
    group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.2, 0.4, 0);
    group.add(rightLeg);

    const x = (Math.random() - 0.5) * 30;
    const z = (Math.random() - 0.5) * 30;
    group.position.set(x, 0, z);

    this.scene.add(group);
    this.entities.push({
      mesh: group as any,
      type: 'staff',
      targetX: (Math.random() - 0.5) * 35,
      targetZ: (Math.random() - 0.5) * 35,
      speed: 1 + Math.random(),
      state: 'wandering',
      timer: Math.random() * 8
    });
  }

  // --- Animation loop ---
  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    const rawDelta = this.clock.getDelta();
    const delta = rawDelta * this.speedMultiplier;

    if (this.isActive) {
      this.updateEntities(delta);
    }
    this.updateDollarEffects(rawDelta);

    this.orbitControls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private updateEntities(delta: number): void {
    for (const entity of this.entities) {
      const dx = entity.targetX - entity.mesh.position.x;
      const dz = entity.targetZ - entity.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const arrived = dist < 0.5;

      // Only tick timer when not traveling to checkout (wait starts on arrival)
      if (entity.state === 'at-checkout') {
        if (arrived) {
          entity.timer -= delta;
        }
      } else {
        entity.timer -= delta;
      }

      if (!arrived) {
        const moveX = (dx / dist) * entity.speed * delta;
        const moveZ = (dz / dist) * entity.speed * delta;
        entity.mesh.position.x += moveX;
        entity.mesh.position.z += moveZ;
        entity.mesh.rotation.y = Math.atan2(dx, dz);
      }

      if (entity.type === 'customer') {
        // For 'at-checkout': require arrival AND timer expired (wait at counter)
        // For 'leaving': only advance when arrived at exit
        // For other states: advance on arrival or timer expiry
        if (entity.state === 'at-checkout') {
          if (arrived && entity.timer <= 0) {
            this.updateCustomerState(entity);
          }
        } else if (entity.state === 'leaving') {
          if (arrived) {
            this.updateCustomerState(entity);
          }
        } else {
          if (arrived || entity.timer <= 0) {
            this.updateCustomerState(entity);
          }
        }
      } else {
        if (arrived || entity.timer <= 0) {
          const shelf = this.shelves[Math.floor(Math.random() * this.shelves.length)];
          entity.targetX = shelf.position.x + (Math.random() - 0.5) * 4;
          entity.targetZ = shelf.position.z + (Math.random() - 0.5) * 3;
          entity.timer = 4 + Math.random() * 5;
        }
      }
    }
  }

  private updateCustomerState(entity: SimEntity): void {
    switch (entity.state) {
      case 'wandering':
        // Go browse a shelf
        const shelf = this.shelves[Math.floor(Math.random() * this.shelves.length)];
        entity.targetX = shelf.position.x + (Math.random() - 0.5) * 3;
        entity.targetZ = shelf.position.z + 2;
        entity.state = 'shopping';
        entity.timer = 3 + Math.random() * 4;
        break;

      case 'shopping':
        // After browsing, either shop more or go to checkout
        if (Math.random() < 0.4) {
          // Head to a checkout counter
          const lane = Math.floor(Math.random() * 4);
          entity.targetX = -9 + lane * 6;
          entity.targetZ = 19;
          entity.state = 'at-checkout';
          entity.timer = 2 + Math.random() * 2; // wait time AFTER arriving
        } else {
          // Browse another shelf
          const nextShelf = this.shelves[Math.floor(Math.random() * this.shelves.length)];
          entity.targetX = nextShelf.position.x + (Math.random() - 0.5) * 3;
          entity.targetZ = nextShelf.position.z + 2;
          entity.timer = 2 + Math.random() * 3;
        }
        break;

      case 'at-checkout':
        // Transaction happens here! Customer reached counter and waited.
        this.spawnDollarEffect(
          entity.mesh.position.x,
          entity.mesh.position.y,
          entity.mesh.position.z
        );
        if (this.onTransaction) {
          this.onTransaction();
        }
        // Leave the store
        entity.targetX = (Math.random() - 0.5) * 4;
        entity.targetZ = 26;
        entity.state = 'leaving';
        entity.timer = 3;
        break;

      case 'leaving':
        // Re-enter the store as a new shopper
        entity.mesh.position.set((Math.random() - 0.5) * 4, 0, 25);
        entity.targetX = (Math.random() - 0.5) * 30;
        entity.targetZ = (Math.random() - 0.5) * 20;
        entity.state = 'wandering';
        entity.timer = 2 + Math.random() * 4;
        break;
    }
  }

  setCustomerCount(count: number): void {
    const target = Math.max(3, Math.min(100, count));
    const currentCustomers = this.entities.filter(e => e.type === 'customer');
    if (target > currentCustomers.length) {
      // Add more customers
      for (let i = 0; i < target - currentCustomers.length; i++) {
        this.spawnCustomer();
      }
    } else if (target < currentCustomers.length) {
      // Remove excess customers
      const toRemove = currentCustomers.length - target;
      for (let i = 0; i < toRemove; i++) {
        const entity = currentCustomers[currentCustomers.length - 1 - i];
        this.scene.remove(entity.mesh);
        this.entities.splice(this.entities.indexOf(entity), 1);
      }
    }
    this.customerCount = target;
  }

  setSpeed(multiplier: number): void {
    this.speedMultiplier = Math.max(0.25, Math.min(5, multiplier));
  }

  setSimulationActive(active: boolean): void {
    this.isActive = active;
  }

  reset(): void {
    for (const entity of this.entities) {
      this.scene.remove(entity.mesh);
    }
    this.entities = [];
    for (const effect of this.dollarEffects) {
      this.scene.remove(effect.sprite);
      effect.sprite.material.dispose();
    }
    this.dollarEffects = [];
    this.deselectObject();
    this.spawnEntities(this.customerCount);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.transformControls.dispose();
    this.orbitControls.dispose();
    this.renderer.dispose();
  }

  private onResize = (): void => {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };
}
