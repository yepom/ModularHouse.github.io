// ThreeCSG.js
// A self-contained version of ThreeCSG without ES6 imports for compatibility

(function(global) {

    const EPSILON = 1e-5;
    const COLINEAR = 0;
    const FRONT = 1;
    const BACK = 2;
    const SPANNING = 3;

    function Polygon(vertices) {
        this.vertices = vertices;
        this.plane = Plane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
    }

    Polygon.prototype = {
        clone: function() {
            const vertices = this.vertices.map(v => v.clone());
            return new Polygon(vertices);
        },
        flip: function() {
            this.vertices.reverse().map(v => v.flip());
            this.plane.flip();
        },
        classifyVertex: function(vertex) {
            const side = this.plane.distanceToPoint(vertex.pos);
            return side < -EPSILON ? BACK : side > EPSILON ? FRONT : COLINEAR;
        },
        classifySide: function(polygon) {
            let numFront = 0, numBack = 0;
            for (let i = 0; i < polygon.vertices.length; i++) {
                switch (this.classifyVertex(polygon.vertices[i])) {
                    case FRONT: numFront++; break;
                    case BACK: numBack++; break;
                }
            }
            return (numFront && numBack) ? SPANNING : numFront ? FRONT : numBack ? BACK : COLINEAR;
        },
        splitPolygon: function(polygon, coplanarFront, coplanarBack, front, back) {
            const classification = this.classifySide(polygon);
            if (classification === COLINEAR) {
                (this.plane.normal.dot(polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
            } else if (classification === FRONT) {
                front.push(polygon);
            } else if (classification === BACK) {
                back.push(polygon);
            } else {
                let f = [], b = [];
                for (let i = 0; i < polygon.vertices.length; i++) {
                    let j = (i + 1) % polygon.vertices.length;
                    let vi = polygon.vertices[i], vj = polygon.vertices[j];
                    let ti = this.classifyVertex(vi), tj = this.classifyVertex(vj);
                    if (ti != BACK) f.push(vi);
                    if (ti != FRONT) b.push(vi);
                    if ((ti | tj) === SPANNING) {
                        const t = (this.plane.w - this.plane.normal.dot(vi.pos)) / this.plane.normal.dot(vj.pos.clone().sub(vi.pos));
                        const v = vi.interpolate(vj, t);
                        f.push(v);
                        b.push(v);
                    }
                }
                if (f.length >= 3) front.push(new Polygon(f));
                if (b.length >= 3) back.push(new Polygon(b));
            }
        }
    };

    function Vertex(pos, normal) {
        this.pos = pos;
        this.normal = normal;
    }

    Vertex.prototype = {
        clone: function() {
            return new Vertex(this.pos.clone(), this.normal.clone());
        },
        flip: function() {
            this.normal.negate();
        },
        interpolate: function(other, t) {
            return new Vertex(
                this.pos.clone().lerp(other.pos, t),
                this.normal.clone().lerp(other.normal, t)
            );
        }
    };

    function Plane(normal, w) {
        this.normal = normal;
        this.w = w;
    }

    Plane.prototype = {
        clone: function() {
            return new Plane(this.normal.clone(), this.w);
        },
        flip: function() {
            this.normal.negate();
            this.w = -this.w;
        },
        distanceToPoint: function(point) {
            return this.normal.dot(point) - this.w;
        }
    };

    Plane.fromPoints = function(a, b, c) {
        const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        return new Plane(n, n.dot(a));
    };

    function Node(polygons) {
        this.plane = null;
        this.front = null;
        this.back = null;
        this.polygons = [];
        if (polygons) this.build(polygons);
    }

    Node.prototype = {
        clone: function() {
            const node = new Node();
            node.plane = this.plane && this.plane.clone();
            node.front = this.front && this.front.clone();
            node.back = this.back && this.back.clone();
            node.polygons = this.polygons.map(p => p.clone());
            return node;
        },
        build: function(polygons) {
            if (!polygons.length) return;
            if (!this.plane) this.plane = polygons[0].plane.clone();
            let front = [], back = [];
            for (let i = 0; i < polygons.length; i++) {
                this.plane.splitPolygon(polygons[i], this.polygons, this.polygons, front, back);
            }
            if (front.length) {
                if (!this.front) this.front = new Node();
                this.front.build(front);
            }
            if (back.length) {
                if (!this.back) this.back = new Node();
                this.back.build(back);
            }
        },
        clipPolygons: function(polygons) {
            if (!this.plane) return polygons.slice();
            let front = [], back = [];
            for (let i = 0; i < polygons.length; i++) {
                this.plane.splitPolygon(polygons[i], front, back, front, back);
            }
            if (this.front) front = this.front.clipPolygons(front);
            if (this.back) back = this.back.clipPolygons(back);
            else back = [];
            return front.concat(back);
        },
        invert: function() {
            for (let i = 0; i < this.polygons.length; i++) {
                this.polygons[i].flip();
            }
            this.plane.flip();
            if (this.front) this.front.invert();
            if (this.back) this.back.invert();
            const temp = this.front;
            this.front = this.back;
            this.back = temp;
        },
        clipTo: function(bsp) {
            this.polygons = bsp.clipPolygons(this.polygons);
            if (this.front) this.front.clipTo(bsp);
            if (this.back) this.back.clipTo(bsp);
        }
    };

    function CSG() {
        this.polygons = [];
    }

    CSG.prototype = {
        clone: function() {
            const csg = new CSG();
            csg.polygons = this.polygons.map(p => p.clone());
            return csg;
        },
        toPolygons: function() {
            return this.polygons;
        },
        union: function(csg) {
            const a = new Node(this.clone().polygons);
            const b = new Node(csg.clone().polygons);
            a.clipTo(b);
            b.clipTo(a);
            b.invert();
            b.clipTo(a);
            b.invert();
            a.build(b.allPolygons());
            return CSG.fromPolygons(a.allPolygons());
        },
        subtract: function(csg) {
            const a = new Node(this.clone().polygons);
            const b = new Node(csg.clone().polygons);
            a.invert();
            a.clipTo(b);
            b.clipTo(a);
            b.invert();
            b.clipTo(a);
            b.invert();
            a.build(b.allPolygons());
            a.invert();
            return CSG.fromPolygons(a.allPolygons());
        },
        intersect: function(csg) {
            const a = new Node(this.clone().polygons);
            const b = new Node(csg.clone().polygons);
            a.invert();
            b.clipTo(a);
            b.invert();
            a.clipTo(b);
            b.clipTo(a);
            a.build(b.allPolygons());
            a.invert();
            return CSG.fromPolygons(a.allPolygons());
        }
    };

    CSG.fromPolygons = function(polygons) {
        const csg = new CSG();
        csg.polygons = polygons;
        return csg;
    };

    CSG.fromGeometry = function(geometry) {
        const polygons = [];
        for (let i = 0; i < geometry.faces.length; i++) {
            const face = geometry.faces[i];
            const vertices = [];
            vertices.push(new Vertex(geometry.vertices[face.a].clone(), face.vertexNormals[0].clone()));
            vertices.push(new Vertex(geometry.vertices[face.b].clone(), face.vertexNormals[1].clone()));
            vertices.push(new Vertex(geometry.vertices[face.c].clone(), face.vertexNormals[2].clone()));
            polygons.push(new Polygon(vertices));
        }
        return CSG.fromPolygons(polygons);
    };

    CSG.toGeometry = function(csg) {
        const geometry = new THREE.Geometry();
        const polygons = csg.toPolygons();
        const vertices = [];
        const faces = [];
        const normals = [];
        polygons.forEach(function(polygon) {
            const vertexOffset = vertices.length;
            for (let i = 0; i < polygon.vertices.length; i++) {
                const vertex = polygon.vertices[i];
                vertices.push(vertex.pos);
                normals.push(vertex.normal);
            }
            for (let i = 2; i < polygon.vertices.length; i++) {
                const face = new THREE.Face3(vertexOffset, vertexOffset + i - 1, vertexOffset + i);
                face.vertexNormals = [
                    normals[vertexOffset],
                    normals[vertexOffset + i - 1],
                    normals[vertexOffset + i]
                ];
                faces.push(face);
            }
        });
        geometry.vertices = vertices;
        geometry.faces = faces;
        geometry.computeFaceNormals();
        return geometry;
    };

    CSG.fromMesh = function(mesh) {
        const csg = CSG.fromGeometry(mesh.geometry);
        mesh.updateMatrix();
        const matrix = mesh.matrix;
        csg.polygons.forEach(function(polygon) {
            polygon.vertices.forEach(function(vertex) {
                vertex.pos.applyMatrix4(matrix);
                vertex.normal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix));
            });
        });
        return csg;
    };

    CSG.toMesh = function(csg, matrix) {
        const geometry = CSG.toGeometry(csg);
        const material = new THREE.MeshNormalMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.applyMatrix4(matrix);
        return mesh;
    };

    global.CSG = CSG;

})(this);
