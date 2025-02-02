"use strict";

class SM83_RWMIO_t {
    constructor() {
        this.RD = 0;
        this.WR = 0;
        this.MRQ = 0;
        this.IO = 0;
    }

    reset() {
        this.RD = 0;
        this.WR = 0;
        this.MRQ = 0;
        this.IO = 0;
    }

    copy(what) {
        this.RD = what.RD;
        this.WR = what.WR;
        this.MRQ = what.MRQ;
        this.IO = what.IO;
    }
}

class SM83_switchgen {
    constructor(indent, what) {
        this.indent1 = indent;
        this.indent2 = '    ' + this.indent1;
        this.indent3 = '    ' + this.indent2;
        this.in_case = false;
        this.last_case = 0;
        this.added_lines = 0;
        this.has_footer = false;
        this.no_addr_at_end = false;
        this.outstr = this.indent1 + 'switch(regs.TCU) {\n';
        this.has_cycle = false;
        this.on_cycle = [];
        this.queued_line = false;

        this.RWMIO_start = new SM83_RWMIO_t();
        this.RWMIO_end = new SM83_RWMIO_t();

        // We *ALWAYS* start with a READ and MRQ
        this.RWMIO_start.RD = 1;
        this.RWMIO_start.MRQ = 1;

        this.cycle_has_line = false;

        this.force_queue = false;

        this.rwmio_str = null;

        this.opcode_info = what;

        this.queued_RWMIO = [];
    }

    psaddl(what) {
        this.added_lines++;
        this.outstr = this.indent1 + what + '\n' + this.outstr;
    }

    addl(what) {
        if (this.force_queue) {
            this.on_cycle.push(what);
            this.queued_line = true;
            return;
        }
        this.added_lines++;
        this.cycle_has_line = true;
        if (this.has_cycle)
            this.outstr += this.indent3 + what + '\n';
        else
            this.on_cycle.push(what);
    }

    // We actually ignore the input cycle #
    // This is determined automatically
    // Passed in is reference cycle # and/or a comment for the bros
    addcycle(whatup) {
        if (this.in_case) {
            this.RWM_finish();
            this.outstr += this.indent3 + 'break;\n';
        }
        let what = (parseInt(this.last_case) + 1).toString();
        this.last_case = what;
        this.in_case = true;
        if (typeof (whatup) !== 'undefined')
            this.outstr += this.indent2 + 'case ' + what + ': // ' + whatup + '\n';
        else
            this.outstr += this.indent2 + 'case ' + what + ':\n';
        for (let i in this.queued_RWMIO) {
            let qw = this.queued_RWMIO[i];
            this.RWM(qw[0], qw[1], qw[2]);
        }
        this.queued_RWMIO = [];
        if ((!this.has_cycle) || (this.queued_line) || (this.force_queue)) {
            this.queued_line = false;
            this.has_cycle = true;
            this.force_queue = false;
            for (let i in this.on_cycle) {
                this.addl(this.on_cycle[i])
            }
            this.on_cycle = [];
            this.has_cycle = true;
        }
        this.cycle_has_line = false;
        this.force_queue = false;
    }

    push(what) {
        // write hi
        // write lo
        this.addl('regs.SP = (regs.SP - 1) & 0xFFFF;');
        this.write('regs.SP', '(' + what + ' & 0xFF00) >>> 8');

        this.addl('regs.SP = (regs.SP - 1) & 0xFFFF;');
        this.write('regs.SP', what + ' & 0xFF');
    }

    push16(reg) {
        let h, l;
        switch(reg) {
            case 'HL':
                h = 'regs.H';
                l = 'regs.L';
                break;
            case 'DE':
                h = 'regs.D';
                l = 'regs.E';
                break;
            case 'BC':
                h = 'regs.B';
                l = 'regs.C';
                break;
            case 'AF':
                h = 'regs.A';
                l = 'regs.F.getbyte()';
                break;
            case 'PC':
                h = '(regs.PC & 0xFF00) >>> 8';
                l = '(regs.PC & 0xFF)';
                break;
            default:
                console.log('PUSH16 UNKNOWN THING', reg);
                return;
        }
        this.addl('regs.SP = (regs.SP - 1) & 0xFFFF;');
        this.write('regs.SP', h);

        this.addl('regs.SP = (regs.SP - 1) & 0xFFFF;');
        this.write('regs.SP', l);
    }

    popAF() {
        this.read('regs.SP', 'regs.TR');
        this.force_q();
        this.addl('regs.F.setbyte(regs.TR & 0xF0);');
        this.addl('regs.SP = (regs.SP + 1) & 0xFFFF;');
        this.read('regs.SP', 'regs.A');
        this.addl('regs.SP = (regs.SP + 1) & 0xFFFF;');
    }

    pop16(reg) {
        let h, l;
        switch(reg) {
            case 'HL':
                h = 'regs.H';
                l = 'regs.L';
                break;
            case 'DE':
                h = 'regs.D';
                l = 'regs.E';
                break;
            case 'BC':
                h = 'regs.B';
                l = 'regs.C';
                break;
            default:
                console.log('POP16 UNKNOWN THING', reg);
                return;
        }
        this.read('regs.SP', l);
        this.addl('regs.SP = (regs.SP + 1) & 0xFFFF;');
        this.read('regs.SP', h);
        this.addl('regs.SP = (regs.SP + 1) & 0xFFFF;');
    }

    pop() {
        this.read('regs.SP', 'regs.TA');
        this.addl('regs.SP = (regs.SP + 1) & 0xFFFF;');
        this.force_q();
        this.read('regs.SP', 'regs.TR');
        this.addl('regs.SP = (regs.SP + 1) & 0xFFFF;');
        this.force_q();
        this.addl('regs.TA |= (regs.TR << 8);');
    }

    force_noq(what) {
        this.outstr += this.indent3 + what + '\n';
    }

    force_q() {
        this.force_queue = true;
    }

    q_line(l) {
        this.queued_line = true;
        this.on_cycle.push(l);
    }

    // This is a final "cycle" only SOME functions use, mostly to get final data read done
    cleanup() {
        this.has_footer = true;
        this.addcycle('cleanup_custom');
    }

    regular_end() {
        this.addl('// Following is auto-generated code for instruction finish')
        if (!this.has_footer) {
            this.addcycle('cleanup_custom');
        }
        if (!this.no_addr_at_end)
            this.addr_to_PC_then_inc();
        this.RWM(1, 0, 1);
        this.addl('regs.TCU = 0;');
        this.addl('regs.IR = SM83_S_DECODE;');
        this.addl('regs.poll_IRQ = true;');
        this.RWM_finish();
        this.addl('break;');
    }

    RWM(rd, wr, mrq) {
        this.RWMIO_end.RD = rd;
        this.RWMIO_end.WR = wr;
        this.RWMIO_end.MRQ = mrq;
    }

    RWM_finish() {
        if ((this.RWMIO_start.RD !== this.RWMIO_end.RD) || (this.RWMIO_start.WR !== this.RWMIO_end.WR) ||
            (this.RWMIO_start.MRQ !== this.RWMIO_end.MRQ) || (this.RWMIO_start.IO !== this.RWMIO_end.IO)) {
            let ostr = '';
            let ndsp = false;
            if (this.RWMIO_start.RD !== this.RWMIO_end.RD) {
                ostr += 'pins.RD = ' + this.RWMIO_end.RD + ';';
                ndsp = true;
            }
            if (this.RWMIO_start.WR !== this.RWMIO_end.WR) {
                if (ndsp) ostr += ' ';
                ostr += 'pins.WR = ' + this.RWMIO_end.WR + ';';
                ndsp = true;
            }
            if (this.RWMIO_start.MRQ !== this.RWMIO_end.MRQ) {
                if (ndsp) ostr += ' ';
                ostr += 'pins.MRQ = ' + this.RWMIO_end.MRQ + ';';
                ndsp = true;
            }
            if (ostr.length > 0) this.outstr += this.indent3 + ostr + '\n';
        }

        this.RWMIO_start.copy(this.RWMIO_end);
    }

    q_RWM(rd, wr, mrq) {
        this.queued_RWMIO.push([rd, wr, mrq]);
    }

    addr_to_PC() {
        this.addl('pins.Addr = regs.PC;');
    }

    addr_to_PC_then_inc() {
        this.addl('pins.Addr = regs.PC;');
        this.addl('regs.PC = (regs.PC + 1) & 0xFFFF;');
    }

    finished() {
        if ((!this.in_case) && (this.added_lines === 0)) {
            return '';
        }
        this.regular_end();

        this.outstr += this.indent1 + '}\n';
        return this.outstr;
    }

    addcycles(howmany, do_rwmio=true) {
        if (do_rwmio) this.RWM(0, 0, 0);
        let first = true;
        for (let i = 0; i < howmany; i++) {
            if (first) this.addcycle('Adding ' + howmany + ' cycles');
            else this.addcycle();
            first = false;
        }
    }

    write(where, what) {
        this.addcycle('Do write')
        this.addl('pins.Addr = (' + where + ');');
        this.addl('pins.D = ' + what + ';');
        this.RWM(0, 1, 1);

        this.q_RWM(0, 0, 0);
    }

    store(where, what) {
        this.write(where, what + ' & 0xFF');
        this.write('(' + where + ' + 1) & 0xFFFF', '(' + what + ' & 0xFF00) >>> 8');
    }

    read(where, to) {
        this.addcycle('Do read')
        this.addl('pins.Addr = (' + where + ');');
        this.RWM(1, 0, 1);

        this.q_line(to + ' = pins.D;');
        this.q_RWM(0, 0, 0);
    }

    operand(what) {
        this.read('regs.PC', what)
        //this.addl('if (regs.halt_bug) regs.halt_bug = 0;');
        this.addl('regs.PC = (regs.PC + 1) & 0xFFFF;');
    }

    operands(what) {
        this.operand(what);
        this.operand('regs.RR');
        this.force_q();
        this.q_line(what + ' |= (regs.RR << 8);');
    }

    writereg16(what, val) {
        switch(what) {
            case 'HL':
                this.addl('regs.H = (' + val + ' & 0xFF00) >>> 8;');
                this.addl('regs.L = ' + val + ' & 0xFF;');
                break;
            case 'BC':
                this.addl('regs.B = (' + val + ' & 0xFF00) >>> 8;');
                this.addl('regs.C = ' + val + ' & 0xFF;');
                break;
            case 'DE':
                this.addl('regs.D = (' + val + ' & 0xFF00) >>> 8;');
                this.addl('regs.E = ' + val + ' & 0xFF;');
                break;
            case 'SP':
                this.addl('regs.SP = ' + val + ';');
                break;
            default:
                console.log('unknown writereg16!', what);
                debugger;
        }
    }

    writereg8(what, val) {
        switch(what) {
            case 'A':
                this.addl('regs.A = ' + val + ';');
                break;
            case 'B':
                this.addl('regs.B = ' + val + ';');
                break;
            case 'C':
                this.addl('regs.C = ' + val + ';');
                break;
            case 'D':
                this.addl('regs.D = ' + val + ';');
                break;
            case 'E':
                this.addl('regs.E = ' + val + ';');
                break;
            case 'H':
                this.addl('regs.H = ' + val + ';');
                break;
            case 'L':
                this.addl('regs.L = ' + val + ';');
                break;
            case 'F':
                this.addl('regs.F.setbyte(' + val + ');');
                break;
            default:
                console.log('UNKNOWN THING!', what, val);
                debugger;
                break;
        }
    }

    cpreg16(target, source) {
        let sh, sl, dh, dl;
        switch(source) {
            case 'HL':
                if (target === 'SP') {
                    this.addl('regs.H = (regs.SP & 0xFF00) >> 8;');
                    this.addl('regs.L = regs.SP & 0xFF;');
                    return;
                }
                sh = 'regs.H';
                sl = 'regs.L';
                break;
            case 'DE':
                sh = 'regs.D';
                sl = 'regs.E';
                break;
            case 'BC':
                sh = 'regs.B';
                sl = 'regs.C';
                break;
            default:
                console.log('UNKNOWN CPREG16 TOP');
                return;
        }
        switch(target) {
            case 'HL':
                dh = 'regs.H';
                dl = 'regs.L';
                break;
            case 'DE':
                dh = 'regs.D';
                dl = 'regs.E';
                break;
            case 'BC':
                sh = 'regs.B';
                sl = 'regs.C';
                break;
            default:
                console.log('UNKNOWN CPREG16 BOTTOM', target, source);
                return;
        }
        this.addl(sh + ' = ' + dh + ';');
        this.addl(sl + ' = ' + dl + ';');
    }

    getreg8(what) {
        switch(what) {
            case 'A': return 'regs.A';
            case 'B': return 'regs.B';
            case 'C': return 'regs.C';
            case 'D': return 'regs.D';
            case 'E': return 'regs.E';
            case 'H': return 'regs.H';
            case 'L': return 'regs.L';
            case 'F': return 'regs.F.getbyte()';
            default:
                console.log('UNKNOWN GETREG8', what);
        }
    }

    getreg16(what) {
        switch(what) {
            case 'HL': return '(regs.H << 8) | regs.L';
            case 'DE': return '(regs.D << 8) | regs.E';
            case 'BC': return '(regs.B << 8) | regs.C';
            case 'SP': return 'regs.SP';
            default:
                console.log('UNKNOWN GETREG16', what);
        }
    }

    setz(what) {
        this.addl('regs.F.Z = +((' + what + ') ' + GENEQO + ' 0);');
    }

    ADD(target, source, carry=false, output='regs.TR') {
        if (carry) {
            this.addl('let x = (' + target + ') + (' + source + ') + regs.F.C;');
            this.addl('let y = ((' + target + ') & 0x0F) + ((' + source + ') & 0x0F) + regs.F.C;');
        }
        else {
            this.addl('let x = (' + target + ') + (' + source + ');');
            this.addl('let y = ((' + target + ') & 0x0F) + ((' + source + ') & 0x0F);');
        }
        this.addl('regs.F.C = +(x > 0xFF);');
        this.addl('regs.F.H = +(y > 0x0F);');
        this.addl('regs.F.N = 0;');
        this.addl(output + ' = (x & 0xFF);');
        this.setz(output);
    }

    AND(target, source, output='regs.TR') {
        this.addl(output + ' = (' + target + ') & (' + source + ');');
        this.addl('regs.F.C = regs.F.N = 0;');
        this.addl('regs.F.H = 1;');
        this.setz(output);
    }

    BIT(index, target) {
        this.addl('regs.F.H = 1;');
        this.addl('regs.F.N = 0;');
        this.setz(target + ' & ' + (1 << index));
    }

    CP(target, source) {
        this.addl('let x = ((' + target + ') - (' + source + ')) & 0xFFFF;');
        this.addl('let y = (((' + target +') & 0x0F) - ((' + source + ') & 0x0F)) & 0xFFFF;');
        this.addl('regs.F.C = +(x > 0xFF);');
        this.addl('regs.F.H = +(y > 0x0F);');
        this.addl('regs.F.N = 1;');
        this.setz('x & 0xFF');
    }

    DEC(target) {
        this.addl(target + ' = ((' + target + ') - 1) & 0xFF;');
        this.addl('regs.F.H = +(((' + target + ') & 0x0F) ' + GENEQO + ' 0x0F);');
        this.addl('regs.F.N = 1;');
        this.setz(target);
    }

    INC(target) {
        this.addl(target + ' = ((' + target + ') + 1) & 0xFF;');
        this.addl('regs.F.H = +(((' + target + ') & 0x0F) ' + GENEQO + ' 0);');
        this.addl('regs.F.N = 0;');
        this.setz(target);
    }

    OR(target, source, output='regs.TR') {
        this.addl(output + ' = (' + target + ') | (' + source + ');');
        this.addl('regs.F.C = regs.F.N = regs.F.H = 0;');
        this.setz(output);
    }

    RL(target) {
        this.addl('let carry = ((' + target + ') & 0x80) >>> 7;');
        this.addl(target + ' = (((' + target + ') << 1) & 0xFE) | regs.F.C;');
        this.addl('regs.F.C = carry;');
        this.addl('regs.F.H = regs.F.N = 0;');
        this.setz(target);
    }

    RR(target) {
        this.addl('let carry = (' + target + ') & 1;');
        this.addl(target + ' = ((' + target + ') >>> 1) | (regs.F.C << 7);');
        this.addl('regs.F.C = carry;');
        this.addl('regs.F.H = regs.F.N = 0;');
        this.setz(target);
    }

    RLC(target) {
        this.addl(target + ' = ((' + target + ' << 1) | (' + target + ' >>> 7)) & 0xFF;');
        this.addl('regs.F.C = ' + target + ' & 1;');
        this.addl('regs.F.H = regs.F.N = 0;');
        this.setz(target);
    }

    RRC(target) {
        this.addl(target + ' = (((' + target + ') << 7) | ((' + target + ') >>> 1)) & 0xFF;');
        this.addl('regs.F.C = ((' + target + ') & 0x80) >>> 7;');
        this.addl('regs.F.H = regs.F.N = 0;');
        this.setz(target);
    }

    SLA(target) {
        this.addl('let carry = ((' + target + ') & 0x80) >>> 7;');
        this.addl(target + ' = ((' + target + ') << 1) & 0xFF;');
        this.addl('regs.F.C = carry;');
        this.addl('regs.F.H = regs.F.N = 0;');
        this.setz(target);
    }

    SRA(target) {
        this.addl('let carry = (' + target + ') & 1;');
        this.addl(target + ' = ((' + target + ') & 0x80) | ((' + target + ') >>> 1);');
        this.addl('regs.F.C = carry;');
        this.addl('regs.F.H = regs.F.N = 0;');
        this.setz(target);
    }

    SRL(target) {
        this.addl('regs.F.C = (' + target + ') & 1;');
        this.addl(target + ' = (' + target + ') >>> 1;');
        this.addl('regs.F.H = regs.F.N = 0;');
        this.setz(target);
    }

    SUB(target, source, carry=false, output='regs.TR') {
        if (carry) {
            this.addl('let x = ((' + target + ') - (' + source + ') - regs.F.C) & 0xFFFF;')
            this.addl('let y = (((' + target + ') & 0x0F) - ((' + source + ') &0x0F) - regs.F.C) & 0xFFFF;');
        } else {
            this.addl('let x = ((' + target + ') - (' + source + ')) & 0xFFFF;');
            this.addl('let y = (((' + target + ') & 0x0F) - ((' + source + ') & 0x0F)) & 0xFFFF;');
        }
        this.addl('regs.F.C = +(x > 0xFF);');
        this.addl('regs.F.H = +(y > 0x0F);');
        this.addl('regs.F.N = 1;');
        this.addl(output + ' = x & 0xFF;');
        this.setz(output);
    }

    SWAP(target) {
        this.addl(target + ' = (((' + target + ') << 4) | ((' + target + ') >>> 4)) & 0xFF;');
        this.addl('regs.F.C = regs.F.H = regs.F.N = 0;');
        this.setz(target);
    }

    XOR(target, source, output='regs.TR') {
        this.addl(output + ' = (' + target + ') ^ (' + source + ');');
        this.addl('regs.F.C = regs.F.N = regs.F.H = 0;');
        this.setz(output);
    }

}

/**
 * @param {String} indent
 * @param {SM83_opcode_info} opcode_info
 */
function SM83_generate_instruction_function(indent, opcode_info) {
    let indent2 = indent + '    ';
    let ag = new SM83_switchgen(indent2, opcode_info);
    if (typeof opcode_info === 'undefined') debugger;
    let arg1 = opcode_info.arg1;
    let arg2 = opcode_info.arg2;
    let target, data, mask, bit;
    switch (opcode_info.ins) {
        case SM83_MN.ADC_di_da:
            ag.operand('regs.TR');
            ag.force_q();
            ag.ADD(ag.getreg8(arg1), 'regs.TR', true);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.ADC_di_di:
            ag.ADD(ag.getreg8(arg1), ag.getreg8(arg2), true);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.ADC_di_ind:
            ag.read(ag.getreg16(arg2), 'regs.TR');
            ag.force_q();
            ag.ADD(ag.getreg8(arg1), 'regs.TR', true);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.ADD_di_da:
            ag.operand('regs.TR');
            ag.force_q();
            ag.ADD(ag.getreg8(arg1), 'regs.TR', false);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.ADD_di_di:
            ag.ADD(ag.getreg8(arg1), ag.getreg8(arg2), false);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.ADD16_di_di:
            ag.addcycle('idle');
            let target = ag.getreg16(arg1);
            let source = ag.getreg16(arg2);
            ag.addl('let target = ' + target + ';');
            ag.addl('let source = ' + source + ';');
            ag.addl('let x = target + source;');
            ag.addl('let y = (target & 0xFFF) + (source & 0xFFF);');
            ag.writereg16(arg1,'x');
            ag.addl('regs.F.C = +(x > 0xFFFF);');
            ag.addl('regs.F.H = +(y > 0x0FFF);');
            ag.addl('regs.F.N = 0;');
            break;
        case SM83_MN.ADD_di_ind:
            ag.read(ag.getreg16(arg2), 'regs.TR');
            ag.force_q();
            ag.ADD(ag.getreg8(arg1), 'regs.TR', false);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.ADD_di_rel:
            ag.operand('regs.TR');
            ag.addcycle();
            ag.RWM(0, 0, 0);
            ag.addcycle();
            ag.addl('let target = ' + ag.getreg16(arg1) + ';');
            ag.addl('regs.F.C = +(((target & 0xFF) + regs.TR) > 0xFF);');
            ag.addl('regs.F.H = +(((target & 0x0F) + (regs.TR & 0x0F)) > 0x0F);');
            ag.addl('regs.F.N = regs.F.Z = 0;');
            ag.addl('target = (target + mksigned8(regs.TR)) & 0xFFFF;');
            ag.writereg16(arg1, 'target');
            break;
        case SM83_MN.AND_di_da:
            ag.operand('regs.TR');
            ag.force_q();
            ag.AND(ag.getreg8(arg1), 'regs.TR');
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.AND_di_di:
            ag.AND(ag.getreg8(arg1), ag.getreg8(arg2));
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.AND_di_ind:
            ag.read(ag.getreg16(arg2), 'regs.TR');
            ag.force_q();
            ag.AND(ag.getreg8(arg1), 'regs.TR');
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.BIT_idx_di:
            ag.BIT(arg1, ag.getreg8(arg2));
            break;
        case SM83_MN.BIT_idx_ind:
            ag.read(ag.getreg16(arg2), 'regs.TR');
            ag.force_q();
            ag.BIT(arg1, 'regs.TR');
            break;
        case SM83_MN.CALL_cond_addr:
            // 3 M if false, 6 M if true
            // 1 is already taken before getting here
            // 2 by operands
            ag.operands('regs.TA');
            ag.force_noq('if (!(' + arg1 + ')) { regs.TCU += 3; break; } // CHECKHERE');
            ag.addcycle();
            ag.push('regs.PC');
            ag.addl('regs.PC = regs.TA;');
            break;
        case SM83_MN.CCF:
            ag.addl('regs.F.C ^= 1;');
            ag.addl('regs.F.H = regs.F.N = 0;');
            break;
        case SM83_MN.CP_di_da:
            ag.operand('regs.TR');
            ag.force_q();
            ag.CP(ag.getreg8(arg1), 'regs.TR');
            break;
        case SM83_MN.CP_di_di:
            ag.CP(ag.getreg8(arg1), ag.getreg8(arg2));
            break;
        case SM83_MN.CP_di_ind:
            ag.read(ag.getreg16(arg2), 'regs.TR');
            ag.force_q();
            ag.CP(ag.getreg8(arg1), 'regs.TR');
            break;
        case SM83_MN.CPL:
            ag.addl('regs.A ^= 0xFF;');
            ag.addl('regs.F.H = regs.F.N = 1;');
            break;
        case SM83_MN.DAA:
            ag.addl('let a = regs.A;');
            ag.addl('if (!regs.F.N) {');
            ag.addl('    if (regs.F.H || ((regs.A & 0x0F) > 0x09)) a += 0x06;');
            ag.addl('    if (regs.F.C || (regs.A > 0x99)) {');
            ag.addl('        a += 0x60;');
            ag.addl('        regs.F.C = 1;');
            ag.addl('    }');
            ag.addl('} else {');
            ag.addl('    a -= (0x06 * regs.F.H);');
            ag.addl('    a -= (0x60 * regs.F.C);');
            ag.addl('}');
            ag.addl('regs.A = a & 0xFF;');
            ag.addl('regs.F.H = 0;');
            ag.setz('regs.A');
            break;
        case SM83_MN.DEC_di:
            ag.DEC(ag.getreg8(arg1));
            break;
        case SM83_MN.DEC16_di:
            ag.addcycle();
            ag.addl('let a = ' + ag.getreg16(arg1) + ';');
            ag.addl('a = (a - 1) & 0xFFFF;');
            ag.writereg16(arg1, 'a');
            break;
        case SM83_MN.DEC_ind:
            ag.addl('regs.TA = ' + ag.getreg16(arg1) + ';');
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.DEC('regs.TR');
            ag.write('regs.TA', 'regs.TR');
            break;
        case SM83_MN.DI:
            ag.addl('regs.IME = 0;');
            ag.addl("//console.log('DI!');");
            break;
        case SM83_MN.EI:
            ag.addl("//console.log('EI!');");
            ag.addl('regs.IME_DELAY = 2;');
            break;
        case SM83_MN.HALT:
            ag.addl("console.log('HALT!');");
            ag.addl('if ((!regs.IME) && (regs.interrupt_latch !== 0)) regs.halt_bug = 1; ')
            ag.addl('regs.HLT = 1;');
            ag.addcycle();
            ag.addl('if (regs.HLT) { regs.poll_IRQ = true; regs.TCU--; }');
            ag.cleanup();
            ag.addl('//YOYOYO');
            break;
        case SM83_MN.INC_di:
            ag.INC(ag.getreg8(arg1));
            break;
        case SM83_MN.INC16_di:
            ag.addcycle();
            ag.addl('let a = ' + ag.getreg16(arg1) + ';');
            ag.addl('a = (a + 1) & 0xFFFF;');
            ag.writereg16(arg1, 'a');
            break;
        case SM83_MN.INC_ind:
            ag.addl('regs.TA = ' + ag.getreg16(arg1) + ';');
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.INC('regs.TR');
            ag.write('regs.TA', 'regs.TR');
            break;
        case SM83_MN.JP_cond_addr:
            if (opcode_info.opcode === 0xC3) {
                ag.operands('regs.TA');
                ag.addl('regs.PC = regs.TA;');
                ag.addcycle();
            }
            else {
                // 3 cycles false, 4 true
                // 1 already taken
                // so
                // read
                // read
                // extra if taken
                // cleanup
                ag.operands('regs.TA');
                ag.force_noq('if (!(' + arg1 + ')) { regs.TCU++; }')
                ag.addcycle();
                ag.addl('regs.PC = regs.TA');
                ag.cleanup();
            }
            break;
        case SM83_MN.JP_di:
            ag.addl('regs.PC = ' + ag.getreg16(arg1) + ';');
            break;
        case SM83_MN.JR_cond_rel:
            ag.operand('regs.TA');
            ag.addl('if (!(' + arg1 + ')) { regs.TCU += 1; break; } // CHECKHERE');
            ag.addcycle();
            ag.addl('regs.PC = (mksigned8(regs.TA) + regs.PC) & 0xFFFF;');
            break;
        case SM83_MN.LD_addr_di:
            ag.operands('regs.TA');
            ag.write('regs.TA', ag.getreg8(arg1));
            break;
        case SM83_MN.LD16_addr_di:
            ag.operands('regs.TA');
            ag.store('regs.TA', ag.getreg16(arg1));
            break;
        case SM83_MN.LD_di_addr:
            ag.operands('regs.TA');
            ag.read('regs.TA', ag.getreg8(arg1));
            break;
        case SM83_MN.LD_di_da:
            ag.operand(ag.getreg8(arg1));
            break;
        case SM83_MN.LD16_di_da:
            ag.operands('regs.TR');
            ag.writereg16(arg1, 'regs.TR');
            break;
        case SM83_MN.LD_di_di:
            ag.writereg8(arg1, ag.getreg8(arg2));
            break;
        case SM83_MN.LD16_di_di:
            ag.addcycle();
            ag.addl('regs.SP = (regs.H << 8) | regs.L;');
            //ag.cpreg16(arg1, arg2);
            break;
        case SM83_MN.LD_di_di_rel:
            ag.operand('regs.TR');
            ag.addcycle();
            ag.addl('let source = ' + ag.getreg16(arg2) + ';');
            ag.addl('regs.F.C = +(((source & 0xFF) + regs.TR) > 0xFF);');
            ag.addl('regs.F.H = +(((source & 0x0F) + (regs.TR & 0x0F)) > 0x0F);');
            ag.addl('regs.F.N = regs.F.Z = 0;');
            ag.addl('source = (source + mksigned8(regs.TR)) & 0xFFFF;');
            ag.writereg16(arg1, 'source');
            break;
        case SM83_MN.LD_di_ind:
            ag.addl('regs.TA = ' + ag.getreg16(arg2));
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.LD_di_ind_dec:
            ag.addl('regs.TA = ' + ag.getreg16(arg2));
            ag.read('regs.TA', 'regs.TR');
            ag.addl('regs.TA = (regs.TA - 1) & 0xFFFF;');
            ag.writereg16(arg2, 'regs.TA');
            ag.force_q();
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.LD_di_ind_inc:
            ag.addl('regs.TA = ' + ag.getreg16(arg2));
            ag.read('regs.TA', 'regs.TR');
            ag.addl('regs.TA = (regs.TA + 1) & 0xFFFF;');
            ag.writereg16(arg2, 'regs.TA');
            ag.force_q();
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.LD_ind_da:
            ag.operand('regs.TR');
            ag.addl('regs.TA = ' + ag.getreg16(arg1) + ';');
            ag.write('regs.TA', 'regs.TR');
            break;
        case SM83_MN.LD_ind_di:
            ag.addl('regs.TA = ' + ag.getreg16(arg1) + ';');
            ag.write('regs.TA', ag.getreg8(arg2));
            break;
        case SM83_MN.LD_ind_dec_di:
            ag.addl('regs.TA = ' + ag.getreg16(arg1) + ';');
            ag.write('regs.TA', ag.getreg8(arg2));
            ag.addl('regs.TA = (regs.TA - 1) & 0xFFFF;');
            ag.writereg16(arg1, 'regs.TA');
            break;
        case SM83_MN.LD_ind_inc_di:
            ag.addl('regs.TA = ' + ag.getreg16(arg1) + ';');
            ag.write('regs.TA', ag.getreg8(arg2));
            ag.addl('regs.TA = (regs.TA + 1) & 0xFFFF;');
            ag.writereg16(arg1, 'regs.TA');
            break;
        case SM83_MN.LDH_addr_di:
            ag.operand('regs.TA');
            ag.force_q();
            ag.addl('regs.TA |= 0xFF00;');
            ag.write('regs.TA', ag.getreg8(arg1));
            break;
        case SM83_MN.LDH_di_addr:
            ag.operand('regs.TA');
            ag.force_q();
            ag.addl('regs.TA |= 0xFF00;');
            ag.read('regs.TA', ag.getreg8(arg1));
            break;
        case SM83_MN.LDH_di_ind:
            ag.addl('regs.TA = 0xFF00 | ' + ag.getreg8(arg2) + ';');
            ag.read('regs.TA', ag.getreg8(arg1));
            break;
        case SM83_MN.LDH_ind_di:
            ag.addl('regs.TA = 0xFF00 | ' + ag.getreg8(arg1) + ';');
            ag.write('regs.TA', ag.getreg8(arg2));
            break;
        case SM83_MN.NOP:
            ag.addl('//NOPE!')
            ag.cleanup();
            break;
        case SM83_MN.OR_di_da:
            ag.operand('regs.TR');
            ag.force_q();
            ag.OR(ag.getreg8(arg1), 'regs.TR');
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.OR_di_di:
            ag.OR(ag.getreg8(arg1), ag.getreg8(arg2));
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.OR_di_ind:
            ag.read(ag.getreg16(arg2), 'regs.TR');
            ag.force_q();
            ag.OR(ag.getreg8(arg1), 'regs.TR');
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.POP_di:
            ag.pop16(arg1);
            break;
        case SM83_MN.POP_di_AF:
            ag.popAF();
            break;
        case SM83_MN.PUSH_di:
            ag.addcycle();
            ag.push16(arg1);
            break;
        case SM83_MN.RES_idx_di:
            mask = (1 << arg1) ^ 0xFF;
            ag.addl(ag.getreg8(arg2) + ' &= ' + hex0x2(mask) + ';');
            break;
        case SM83_MN.RES_idx_ind:
            mask = (1 << arg1) ^ 0xFF;
            ag.addl('regs.TA = ' + ag.getreg16(arg2));
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.write('regs.TA', 'regs.TR & ' + hex0x2(mask));
            break;
        case SM83_MN.RET:
            ag.pop();
            ag.addcycle();
            ag.addl('regs.PC = regs.TA;');
            break;
        case SM83_MN.RET_cond:
            ag.addcycle();
            ag.addl('if (!(' + arg1 + ')) { pins.RD = 0; pins.MRQ = 0; regs.TCU += 3; break; } // CHECKHERE');
            ag.RWM(0, 0, 0)
            ag.pop();
            ag.addl('regs.PC = regs.TA;');
            ag.addcycle();
            ag.RWM(0, 0, 0);
            break;
        case SM83_MN.RETI:
            ag.pop();
            ag.addcycle();
            ag.addl('regs.PC = regs.TA;');
            ag.addl('regs.IME = 1;');
            break;
        case SM83_MN.RL_di:
            ag.RL(ag.getreg8(arg1));
            break;
        case SM83_MN.RL_ind:
            ag.addl('regs.TA = ' + ag.getreg16(arg1));
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.RL('regs.TR');
            ag.write('regs.TA', 'regs.TR');
            break;
        case SM83_MN.RLA:
            ag.RL('regs.A');
            ag.addl('regs.F.Z = 0;');
            break;
        case SM83_MN.RLC_di:
            ag.RLC(ag.getreg8(arg1));
            break;
        case SM83_MN.RLC_ind:
            ag.addl('regs.TA = ' + ag.getreg16(arg1) + ';');
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.RLC('regs.TR');
            ag.write('regs.TA', 'regs.TR');
            break;
        case SM83_MN.RLCA:
            ag.RLC('regs.A');
            ag.addl('regs.F.Z = 0;');
            break;
        case SM83_MN.RR_di:
            ag.RR(ag.getreg8(arg1));
            break;
        case SM83_MN.RR_ind:
            ag.addl('regs.TA = ' + ag.getreg16(arg1));
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.RR('regs.TR');
            ag.write('regs.TA', 'regs.TR');
            break;
        case SM83_MN.RRA:
            ag.RR('regs.A');
            ag.addl('regs.F.Z = 0;');
            break;
        case SM83_MN.RRC_di:
            ag.RRC(ag.getreg8(arg1));
            break;
        case SM83_MN.RRC_ind:
            ag.addl('regs.TA = ' + ag.getreg16(arg1));
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.RRC('regs.TR');
            ag.write('regs.TA', 'regs.TR');
            break;
        case SM83_MN.RRCA:
            ag.RRC('regs.A');
            ag.addl('regs.F.Z = 0;');
            break;
        case SM83_MN.RST_imp:
            ag.addcycle();
            ag.push('regs.PC');
            ag.addl('regs.PC = ' + hex0x4(arg1) + ';');
            break;
        case SM83_MN.SBC_di_da:
            ag.operand('regs.TR');
            ag.force_q();
            ag.SUB(ag.getreg8(arg1), 'regs.TR', true);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.SBC_di_di:
            ag.SUB(ag.getreg8(arg1), ag.getreg8(arg2), true);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.SBC_di_ind:
            ag.read(ag.getreg16(arg2), 'regs.TR');
            ag.force_q();
            ag.SUB(ag.getreg8(arg1), 'regs.TR', true);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.SCF:
            ag.addl('regs.F.C = 1;');
            ag.addl('regs.F.H = regs.F.N = 0;');
            break;
        case SM83_MN.SET_idx_di:
            bit = 1 << arg1;
            ag.writereg8(arg2, ag.getreg8(arg2) + ' | ' + hex0x2(bit));
            break;
        case SM83_MN.SET_idx_ind:
            bit = 1 << arg1;
            ag.addl('regs.TA = ' + ag.getreg16(arg2));
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.addl('regs.TR |= ' + hex0x2(bit) + ';');
            ag.write('regs.TA', 'regs.TR');
            break;
        case SM83_MN.SLA_di:
            ag.SLA(ag.getreg8(arg1));
            break;
        case SM83_MN.SLA_ind:
            ag.addl('regs.TA = ' + ag.getreg16(arg1));
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.SLA('regs.TR');
            ag.write('regs.TA', 'regs.TR');
            break;
        case SM83_MN.SRA_di:
            ag.SRA(ag.getreg8(arg1));
            break;
        case SM83_MN.SRA_ind:
            ag.addl('regs.TA = ' + ag.getreg16(arg1));
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.SRA('regs.TR');
            ag.write('regs.TA', 'regs.TR');
            break;
        case SM83_MN.SRL_di:
            ag.SRL(ag.getreg8(arg1));
            break;
        case SM83_MN.SRL_ind:
            ag.addl('regs.TA = ' + ag.getreg16(arg1));
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.SRL('regs.TR');
            ag.write('regs.TA', 'regs.TR');
            break;
        case SM83_MN.STOP:
            ag.addcycle();
            ag.addl('if (!regs.stoppable()) {break;}')
            ag.addl("console.log('STP!');");
            ag.addl('regs.STP = 1;');
            ag.addcycle();
            ag.addl('if (regs.STP) regs.TCU--;')
            break;
        case SM83_MN.SUB_di_da:
            ag.operand('regs.TR');
            ag.force_q();
            ag.SUB(ag.getreg8(arg1), 'regs.TR', false);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.SUB_di_di:
            ag.SUB(ag.getreg8(arg1), ag.getreg8(arg2), false);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.SUB_di_ind:
            ag.read(ag.getreg16(arg2), 'regs.TR');
            ag.force_q();
            ag.SUB(ag.getreg8(arg1), 'regs.TR', false);
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.SWAP_di:
            ag.SWAP(ag.getreg8(arg1));
            break;
        case SM83_MN.SWAP_ind:
            ag.addl('regs.TA = ' + ag.getreg16(arg1));
            ag.read('regs.TA', 'regs.TR');
            ag.force_q();
            ag.SWAP('regs.TR');
            ag.write('regs.TA', 'regs.TR');
            break;
         case SM83_MN.XOR_di_da:
            ag.operand('regs.TR');
            ag.force_q();
            ag.XOR(ag.getreg8(arg1), 'regs.TR');
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.XOR_di_di:
            ag.XOR(ag.getreg8(arg1), ag.getreg8(arg2));
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.XOR_di_ind:
            ag.read(ag.getreg16(arg2), 'regs.TR');
            ag.force_q();
            ag.XOR(ag.getreg8(arg1), 'regs.TR');
            ag.writereg8(arg1, 'regs.TR');
            break;
        case SM83_MN.RESET:
            ag.addcycle();
            break;
        case SM83_MN.S_IRQ:
            ag.addcycle();
            //ag.addl("console.log('IRQ TRIGGER');");
            ag.addl('regs.IME = 0;');
            ag.addcycle();
            ag.addl('regs.PC = (regs.PC - 1) & 0xFFFF;');
            ag.push16('PC');
            ag.addcycle();
            ag.addl('regs.PC = regs.IV;');
            break;
   }
   if (GENTARGET === 'js')
       return 'function(regs, pins) { //' + SM83_MN_R[opcode_info.ins] + '\n' + ag.finished() + indent + '}';
   else {
       return 'function(regs: SM83_regs_t, pins: SM83_pins_t): void { // ' + SM83_MN_R[opcode_info.ins] + '\n' + ag.finished() + indent + '}';
   }
}

function SM83_get_opc_by_prefix(prfx, i) {
    switch(prfx) {
        case 0:
            return SM83_opcode_matrix[i];
        case 0xCB:
            return SM83_opcode_matrixCB[i];
        default:
            console.log('WHAT?', hex2(prfx), hex2(i));
            return;
    }
}

function SM83_get_matrix_by_prefix(prfx, i) {
    switch(prfx) {
        case 0:
            return 'SM83_opcode_matrix[' + hex0x2(i) + '], // ' + hex2(i) + '\n';
        case 0xCB:
            return 'SM83_opcode_matrixCB[' + hex0x2(i) + '], // CB ' + hex2(i) + '\n';
    }
}

function str_sm83_opcode_matrix(prefix, ins) {
    switch(prefix) {
        case 0:
            return 'SM83_opcode_matrix.get(' + hex0x2(ins) + ')';
        case 0xCB:
            return 'SM83_opcode_matrixCB.get(' + hex0x2(ins) + ')';
        default:
            console.log('WHAT!?!?!?');
            debugger;
    }
}

function generate_sm83_core_as(output_name='sm83_decoded_opcodes') {
    let outstr = 'import {SM83_opcode_functions, SM83_opcode_matrix, SM83_opcode_matrixCB, SM83_MAX_OPCODE, SM83_S_DECODE} from "../../../component/cpu/sm83/sm83_opcodes";\n' +
        'import {SM83_pins_t, SM83_regs_t} from "../../../component/cpu/sm83/sm83";\n'
    outstr += 'import {mksigned8} from "../../../helpers/helpers"\n'
    outstr += '\nexport var ' + output_name + ': Array<SM83_opcode_functions> = new Array<SM83_opcode_functions>(SM83_MAX_OPCODE+0xFF);';
    outstr += '\n\nfunction sm83_get_opcode_function(opcode: u32): SM83_opcode_functions {';
    outstr += '\n    switch(opcode) {\n'
    let indent = '        ';
    let firstin = false;
    for (let p in SM83_prefixes) {
        let prfx = SM83_prefixes[p];
        for (let i = 0; i <= SM83_MAX_OPCODE; i++) {
            if ((p === 1) && (i > 0xFF)) continue;
            let matrix_code = SM83_prefix_to_codemap[prfx] + i;
            let mystr = indent + 'case ' + hex0x2(matrix_code) + ': return new SM83_opcode_functions(';
            let r = SM83_get_opc_by_prefix(prfx, i);
            if (typeof r === 'undefined') {
                mystr += str_sm83_opcode_matrix(0, 0) + ',\n';
                r = SM83_generate_instruction_function(indent, SM83_get_opc_by_prefix(0, 0));
            } else {
                mystr += str_sm83_opcode_matrix(prfx, i) + ',\n';
                r = SM83_generate_instruction_function(indent, r);
            }
            mystr += '            ' + r + ');';
            if (firstin)
                outstr += '\n';
            firstin = true;
            outstr += mystr;
        }
    }
        outstr += '\n    }';
    outstr += "\n    return new SM83_opcode_functions(SM83_opcode_matrix.get(0), function(regs: SM83_regs_t, pins: SM83_pins_t): void { console.log('INVALID OPCODE');});";
    outstr += '\n}'
    outstr += '\n\nfor (let i = 0; i <= (SM83_MAX_OPCODE+0xFF); i++) {';
    outstr += '\n    ' + output_name + '[i] = sm83_get_opcode_function(i);';
    outstr += '\n}\n'
    return outstr;
}

function generate_sm83_core() {
    let outstr = '"use strict";\n\nconst sm83_decoded_opcodes = Object.freeze({\n';
    let indent = '    ';
    let firstin = false;
    for (let p in SM83_prefixes) {
        let prfx = SM83_prefixes[p];
        for (let i = 0; i <= SM83_MAX_OPCODE; i++) {
            let matrix_code = SM83_prefix_to_codemap[prfx] + i;
            let mystr = indent + hex0x2(matrix_code) + ': new SM83_opcode_functions(';
            let r = SM83_get_opc_by_prefix(prfx, i);
            let ra;
            if (typeof r === 'undefined') {
                mystr += 'SM83_opcode_matrix[0x00],\n';
                ra = SM83_generate_instruction_function(indent, SM83_opcode_matrix[0]);
            }
            else {
                let sre = SM83_get_matrix_by_prefix(prfx, i);
                if (typeof sre === 'undefined') {
                    console.log('WHAT?', hex2(prfx), hex2(i));
                }
                mystr += sre;
                ra = SM83_generate_instruction_function(indent, r);
            }
            mystr += '        ' + ra + ')';
            if (firstin)
                outstr += ',\n';
            firstin = true;
            outstr += mystr;
        }
    }
    outstr += '\n});';
    return outstr;
}
