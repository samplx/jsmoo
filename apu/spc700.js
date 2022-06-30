"use strict";

let SPC_DO_TRACING = false;

class spc700_P {
    constructor() {
        this.C = this.Z = this.I = this.H = this.B = this.P = this.V = this.N = 0;
        this.Z = 1;
        this.DO = 0x00;
    }

    getbyte() {
        return this.C + (this.Z << 1) + (this.I << 2) + (this.H << 3) + (this.B << 4) + (this.P << 5) + (this.V << 6) + (this.N << 7);
    }

    setbyte(val) {
        this.C = val & 1;
        this.Z = (val >>> 1) & 1;
        this.I = (val >>> 2) & 1;
        this.H = (val >>> 3) & 1;
        this.B = (val >>> 4) & 1;
        this.P = (val >>> 5) & 1;
        this.V = (val >>> 6) & 1;
        this.N = (val >>> 7) & 1;
        this.DO = this.P ? 0x0100 : 0x0000;
    }

    formatbyte() {
        let outstr = '';
        outstr += this.N ? 'N' : 'n';
        outstr += this.V ? 'V' : 'v';
        outstr += this.P ? 'P' : 'p';
        outstr += this.B ? 'B' : 'b';
        outstr += this.H ? 'H' : 'h';
        outstr += this.I ? 'I' : 'i';
        outstr += this.Z ? 'Z' : 'z';
        outstr += this.C ? 'C' : 'c';
        return outstr;
    }
}

class spc700_registers {
    constructor() {
        this.IR = 0;  // Instruction Register for opcode

        this.TR = 0;  // Temporary variable for data
        this.TA = 0;  // Temporary variable for address
        this.TA2 = 0; // Temporary address 2
        this.opc_cycles = 0; // Cycle count of current instruction

        this.A = 0; // 8 bits
        this.X = 0; // 8 bits
        this.Y = 0; // 8 bits
        this.SP = 0xEF; // 8 bits
        this.PC = 0; // 16 bits
        this.P = new spc700_P()

        this.traces = [];
    }
}

class spc700 {
    /**
     * @param {snes_memmap} mem_map
     * @param {SNES_clock} clock
     */
    constructor(mem_map, clock) {
        this.mem_map = mem_map;
        this.clock = clock;
        this.mem_map.read_apu = this.read_reg.bind(this);
        this.mem_map.write_apu = this.write_reg.bind(this);

        this.DSP = new SDSP();

        this.io = {
            // F1
            ROM_readable: 1,
            T0_enable: 0,
            T1_enable: 0,
            T2_enable: 0,

            DSPADDR: 0, // F2
            DSPDATA: 0, // F3

            CPUI0: 0,
            CPUO0: 0,
            CPUI1: 0,
            CPUO1: 0,
            CPUI2: 0,
            CPUO2: 0,
            CPUI3: 0,
            CPUO3: 0,

            T0TARGET: 0,
            T1TARGET: 0,
            T2TARGET: 0,
            T0OUT: 0xF,
            T1OUT: 0xF,
            T2OUT: 0xF,
        }

        this.timers = {
            0: { stage1: 0, stage2: 0 },
            1: { stage1: 0, stage2: 0 },
            2: { stage1: 0, stage2: 0 },
        }

        this.RAM = new Uint8Array(0x10000);

        this.cycles = 0; // Cycles to emulate. This can be negative if we're ahead

        this.regs = new spc700_registers();

        this.WAI = false;
        this.STP = false;

        this.cycles_since_start = 0;

        this.ROM = SPC700_BOOT_ROM;
        this.regs.PC = this.ROM[62] + (this.ROM[63] << 8);
        this.regs.IR = this.ROM[this.regs.PC - 0xFFC0];
        this.regs.PC++;

        this.traces = [];
        this.trace_cycles = 0;
        this.trace_on = false;
        this.trace_peek = function(addr){
            let r = this.read8(addr, false);
            return r;
        };
        if (SPC_DO_TRACING) {
            this.enable_tracing(this.trace_peek.bind(this));
        }
    }

    enable_tracing(peek_func) {
        this.trace_peek = peek_func;
        this.trace_cycles = 0;
        this.trace_on = true;
    }

    disable_tracing() {
        this.trace_peek = function(){};
        this.trace_on = false;
    }

    sync_to(how_many) {
        let catch_up = Math.floor((how_many - this.clock.apu_has) / 20) + 1;
        if (catch_up < 1) return;
        this.cycle(catch_up);
    }

    trace_format(da_out, PCO) {
        let outstr = '';
        outstr += '(' + padl((this.trace_cycles - 1).toString(), 6) + ') ' + hex4(PCO) + ' ';
		outstr += ' ' + da_out.disassembled;
		let sp = da_out.disassembled.length;
		while(sp < 16) {
			outstr += ' ';
			sp++;
		}

		/*if (da_out.data8 !== null) outstr += hex0x2(da_out.data8) + '      ';
		else if (da_out.data16 !== null) outstr += hex2((da_out.data16 & 0xFF00) >>> 8) + ' ' + hex2(da_out & 0xFF) + '   ';
		else if (da_out.data24 !== null) outstr += hex2((da_out.data24 & 0xFF0000) >>> 16) + ' ' + hex2((da_out.data24 & 0xFF00) >>> 8) + ' ' + hex2((da_out.data24 & 0xFF) >>> 8);*/

		outstr += 'PC:' + hex0x4(this.regs.PC) + ' ';
		outstr += 'YA:' + hex0x4((this.regs.Y << 8) + this.regs.A);
        outstr += ' A:' + this.regs.A;
		outstr += ' X:' + hex0x2(this.regs.X) + ' Y:' + hex0x2(this.regs.Y);
		outstr += ' SP:' + hex0x2(this.regs.SP) + ' DO:' + hex0x2(this.regs.P.DO);
		outstr += ' P:' + this.regs.P.formatbyte();
		return outstr;
    }

    disassemble() {
        return spc700_disassemble(this);
    }

    cycle(howmany) {
        this.cycles += howmany;
        while (this.cycles > 0) {
            if (this.STP || this.WAI) {
                console.log('STOPPED OR WAID' + this.clock.apu_has);
                this.clock.apu_has += (this.cycles * 20);
                this.advance_timers(this.cycles);
                this.cycles = 0;
                return;
            }

            let opcode_func = SPC_get_decoded_opcode(this.regs);
            if (opcode_func === null) {
                console.log("Can't SPC700 anymore, unimplemented opcode " + hex0x2(this.regs.IR));
                this.STP = true;
                continue;
            }
            else {
                if (this.trace_on) {
                    this.traces.push(this.trace_format(this.disassemble(), (this.regs.PC - 1) & 0xFFFF));
                    dconsole.addl(this.traces[0]);
                    this.traces = [];
                }
                opcode_func(this, this.regs);
            }
            this.clock.apu_has += (this.regs.opc_cycles * 20);
            this.trace_cycles += this.regs.opc_cycles;
            this.advance_timers(this.regs.opc_cycles);
            this.regs.opc_cycles = 0;
        }
    }

    read8(addr, has_effect=true) {
        if ((addr >= 0x00F1) && (addr <= 0x00FF)) {
            let r = this.readIO(addr, has_effect);
            return r;
        }
        if ((addr >= 0xFFC0) && this.io.ROM_readable) return this.ROM[addr - 0xFFC0];
        return this.RAM[addr & 0xFFFF];
    }

    write8(addr, val) {
        if ((addr >= 0x00F1) && (addr <= 0x00FF))
            this.writeIO(addr, val);
        this.RAM[addr & 0xFFFF] = val;
    }

    readIO(addr, has_effect=true) {
        let val;
        switch(addr) {
            case 0xF0: // TEST register we do not emulate
                return 0x0A;
            case 0xF1: // CONTROL - I/O and timer control
                val = this.io.ROM_readable << 7;
                val += 0x30;
                val += this.io.T2_enable << 2;
                val += this.io.T1_enable << 1;
                val += this.io.T0_enable;
                return val;
            case 0xF2:
                return this.io.DSPADDR;
            case 0xF3:
                return this.DSP.read_reg(this.io.DSPADDR);
            case 0xF4:
                return this.io.CPUI0;
            case 0xF5:
                return this.io.CPUI1;
            case 0xF6:
                return this.io.CPUI2;
            case 0xF7:
                return this.io.CPUI3;
            case 0xF8:
            case 0xF9:
                return this.RAM[addr];
            case 0xFA: // Read-only
            case 0xFB:
            case 0xFC:
                return 0;
            case 0xFD:
                val = this.io.T0OUT;
                if (has_effect) this.io.T0OUT = 0;
                return val;
            case 0xFE:
                val = this.io.T1OUT;
                if (has_effect) this.io.T1OUT = 0;
                return val;
            case 0xFF:
                val = this.io.T2OUT;
                if (has_effect) this.io.T2OUT = 0;
                return val;
        }
    }

    writeIO(addr, val) {
        switch(addr) {
            case 0xF0: // TEST register, should not be written
                if (val !== 0x0A) console.log('WARNING SPC700 WRITE REG 0xF0', hex0x2(val));
                return;
            case 0xF1: // CONTROL reg
                this.io.ROM_readable = (val >>> 7) & 1;
                if (val & 0x20) this.io.CPUI2 = this.io.CPUI3 = 0;
                if (val & 0x10) this.io.CPUI0 = this.io.CPUI1 = 0;
                this.io.T2_enable = (val >> 2) & 1;
                this.io.T1_enable = (val >> 1) & 1;
                this.io.T0_enable = val & 1;
                return;
            case 0xF2:
                this.io.DSPADDR = val;
                return;
            case 0xF3:
                this.DSP.write_reg(this.io.DSPADDR, val);
                return;
            case 0xF4:
                this.io.CPUO0 = val;
                return;
            case 0xF5:
                this.io.CPUO1 = val;
                return;
            case 0xF6:
                this.io.CPUO2 = val;
                return;
            case 0xF7:
                this.io.CPUO3 = val;
                return;
            case 0xF8:
            case 0xF9:
                this.RAM[addr] = val;
                return;
            case 0xFA:
                this.io.T0TARGET = val;
                return;
            case 0xFB:
                this.io.T1TARGET = val;
                return;
            case 0xFC:
                this.io.T2TARGET = val;
                return;
            case 0xFD:
            case 0xFE:
            case 0xFF:
                // Read-only
                return;
        }
    }

    read8D(addr) {
        return this.read8((addr & 0xFF) + this.regs.P.DO);
    }

    write8D(addr, val) {
        this.write8((addr & 0xFF) + this.regs.P.DO, val);
    }

    advance_timers(cycles) {
        // Advance stage1
        this.timers[0].stage1 += cycles;
        this.timers[1].stage1 += cycles;
        this.timers[2].stage1 += cycles;
        if (this.io.T0_enable === 0)
            this.timers[0].stage1 &= 127;
        else {
            while(this.timers[0].stage1 > 128) {
                this.timers[0].stage2++;
                if (this.timers[0].stage2 === this.io.T0TARGET) { this.timers[0].stage2 = 0; this.io.T0OUT = (this.io.T0OUT + 1) & 15; }
                this.timers[0].stage1 -= 128;
            }
        }
        if (this.io.T1_enable === 0)
            this.timers[1].stage1 &= 127;
        else {
            while(this.timers[1].stage1 > 128) {
                this.timers[1].stage2++;
                if (this.timers[1].stage2 === this.io.T1TARGET) { this.timers[1].stage2 = 0; this.io.T1OUT = (this.io.T1OUT + 1) & 15; }
                this.timers[1].stage1 -= 128;
            }
        }
        if (this.io.T2_enable === 0)
            this.timers[1].stage2 &= 15;
        else {
            while (this.timers[2].stage1 > 16) {
                this.timers[2].stage2++;
                if (this.timers[2].stage2 === this.io.T2TARGET) {
                    this.timers[2].stage2 = 0;
                    this.io.T2OUT = (this.io.T2OUT + 1) & 15;
                }
                this.timers[2].stage1 -= 16;
            }
        }
    }

    read_reg(addr, val) {
        this.sync_to(this.clock.cpu_has);
        switch(addr & 3) {
            case 0:
                return this.io.CPUO0;
            case 1:
                return this.io.CPUO1;
            case 2:
                return this.io.CPUO2;
            case 3:
                return this.io.CPUO3;

        }
    }

    write_reg(addr, val) {
        switch(addr & 3) {
            case 0:
                this.io.CPUI0 = val;
                return;
            case 1:
                this.io.CPUI1 = val;
                return;
            case 2:
                this.io.CPUI2 = val;
                return;
            case 3:
                this.io.CPUI3 = val;
                return;
        }
        this.sync_to(this.clock.cpu_has);
    }
}

