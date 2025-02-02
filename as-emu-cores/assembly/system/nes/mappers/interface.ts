/*
export interface systemEmulator {
    //serialize(): funcref,
    //deserialize()
    get_description(): machine_description;
    get_screenvars(): Uint32Array;
    finish_frame(): void;
    finish_scanline(): void;
    update_inputs(): void;
    step_master(cycles: u32): void;
    reset(): void;
    load_ROM(): void;
    load_BIOS(): void;
}

 */


import {NES_bus, NES_clock} from "../nes_common";
import {NES_cart} from "../nes_cart";

export enum NES_PPU_mirror_modes {
    Horizontal,
    Vertical,
    FourWay,
    ScreenAOnly,
    ScreenBOnly
}


export enum NES_a12_watcher_edge {
    nothing = 0,
    rise,
    fall
}

export class NES_a12_watcher_t {
    clock: NES_clock
    cycles_down: u32 = 0;
    last_cycle: u32 = 0;
    delay: u32

    constructor(clock: NES_clock) {
        this.clock = clock;
        this.delay = this.clock.timing.ppu_divisor * 3;
    }

    @inline update(addr: u32): NES_a12_watcher_edge {
        let result: NES_a12_watcher_edge = NES_a12_watcher_edge.nothing;
        let ppufc: u32 = this.clock.ppu_frame_cycle;
        if (this.cycles_down > 0) {
            if (this.last_cycle > ppufc)
                this.cycles_down += (89342 - this.last_cycle) + ppufc;
            else
                this.cycles_down += ppufc - this.last_cycle;
        }

        if ((addr & 0x1000) === 0) {
            if (this.cycles_down === 0) {
                this.cycles_down = 1;
                result = NES_a12_watcher_edge.fall;
            }
        }
        else if (addr & 0x1000) {
            if (this.cycles_down > this.delay)
                result = NES_a12_watcher_edge.rise;
            this.cycles_down = 0;
        }
        this.last_cycle = ppufc;

        return result;
    }
}

export interface NES_mapper {
    cycle(howmany: u32): void; // For VRC cycle-counting IRQs
    CPU_read(addr: u32, val: u32, has_effect: u32): u32;
    CPU_write(addr: u32, val: u32): void;
    PPU_read_effect(addr: u32): u32;
    PPU_read_noeffect(addr: u32): u32;
    PPU_write(addr: u32, val: u32): void;
    reset(): void;
    set_cart(cart: NES_cart): void;
    a12_watch(addr: u32): void;
}

export function NES_mirror_ppu_four(addr: u32): u32 {
    return addr & 0xFFF;
}

export function NES_mirror_ppu_vertical(addr: u32): u32 {
    return (addr & 0x0400) | (addr & 0x03FF);
}

export function NES_mirror_ppu_horizontal(addr: u32): u32 {
    return ((addr >>> 1) & 0x0400) | (addr & 0x03FF);
}

export function NES_mirror_ppu_Aonly(addr: u32): u32 {
    return addr & 0x3FF;
}

export function NES_mirror_ppu_Bonly(addr: u32): u32 {
    return 0x400 | (addr & 0x3FF);
}
