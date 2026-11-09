#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 tabBar 线性图标（81x81，4 倍超采样抗锯齿）。"""
import os
from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'images')
os.makedirs(OUT, exist_ok=True)
S = 4
W = 81 * S
OFF = '#8A94A6'
ON = '#1F3A5F'
LW = 5 * S


def canvas():
    im = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def home(d, c):
    d.polygon([(12*S, 40*S), (40*S, 15*S), (68*S, 40*S)], outline=c, width=LW)
    d.line([(20*S, 37*S), (20*S, 66*S), (60*S, 66*S), (60*S, 37*S)], fill=c, width=LW, joint='curve')
    d.line([(34*S, 66*S), (34*S, 49*S), (47*S, 49*S), (47*S, 66*S)], fill=c, width=LW, joint='curve')


def todo(d, c):
    for y in (24, 40, 56):
        d.line([(28*S, y*S), (66*S, y*S)], fill=c, width=LW)
    for y, x in ((24, 12), (40, 12), (56, 12)):
        d.rectangle([x*S, (y-5)*S, (x+10)*S, (y+5)*S], outline=c, width=3*S)
    d.line([(10*S, 40*S), (15*S, 45*S), (22*S, 34*S)], fill=c, width=3*S, joint='curve')


def family(d, c):
    d.ellipse([32*S, 12*S, 48*S, 28*S], outline=c, width=LW)
    d.arc([26*S, 29*S, 54*S, 58*S], 180, 360, fill=c, width=LW)
    d.ellipse([9*S, 22*S, 21*S, 34*S], outline=c, width=4*S)
    d.arc([5*S, 34*S, 25*S, 55*S], 180, 360, fill=c, width=4*S)
    d.ellipse([59*S, 22*S, 71*S, 34*S], outline=c, width=4*S)
    d.arc([55*S, 34*S, 75*S, 55*S], 180, 360, fill=c, width=4*S)
    d.line([(8*S, 66*S), (72*S, 66*S)], fill=c, width=4*S)


def book(d, c):
    d.rectangle([14*S, 16*S, 66*S, 66*S], outline=c, width=LW)
    d.line([(24*S, 29*S), (56*S, 29*S)], fill=c, width=4*S)
    d.line([(24*S, 41*S), (56*S, 41*S)], fill=c, width=4*S)
    d.line([(24*S, 53*S), (44*S, 53*S)], fill=c, width=4*S)
    d.line([(20*S, 16*S), (20*S, 66*S)], fill=c, width=3*S)


def mine(d, c):
    d.ellipse([27*S, 13*S, 53*S, 39*S], outline=c, width=LW)
    d.arc([14*S, 36*S, 66*S, 80*S], 180, 360, fill=c, width=LW)


SHAPES = {'home': home, 'todo': todo, 'family': family, 'book': book, 'mine': mine}

for name, fn in SHAPES.items():
    for suffix, color in (('', OFF), ('-on', ON)):
        im, d = canvas()
        fn(d, color)
        im = im.resize((81, 81), Image.LANCZOS)
        im.save(os.path.join(OUT, 'tab-%s%s.png' % (name, suffix)))
print('生成 %d 个图标 -> %s' % (len(SHAPES) * 2, OUT))
